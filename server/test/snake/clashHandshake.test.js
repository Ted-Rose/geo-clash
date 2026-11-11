import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';
import { CLASH_ACK_TIMEOUT_MS, SPAWN_GRACE_MS } from '../../src/snake/constants.js';

function makeIo() {
  const events = [];
  return {
    _events: events,
    to: (id) => ({ emit: (e, p) => events.push({ target: id, event: e, payload: p }) }),
    emit: (e, p) => events.push({ event: e, payload: p }),
  };
}

function makeGame(t, roomId) {
  const io = makeIo();
  const game = new SnakeGameState({
    io,
    roomId,
    centerLat: 51.5,
    centerLng: -0.12,
    arenaSideMeters: 200,
    foodRespawnIntervalMs: 999_999,
  });
  t.after(() => game.endMatch());
  return { io, game };
}

function freezeTimers(game) {
  if (game._tickHandle) { clearInterval(game._tickHandle); game._tickHandle = null; }
  if (game._foodInterval) { clearInterval(game._foodInterval); game._foodInterval = null; }
}

const PAST_GRACE = () => Date.now() - SPAWN_GRACE_MS - 100;

async function placePlayer(game, id, { lat, lng, tailPoints = [] }) {
  const p = await game.playerStore.get(id);
  p.spawnedAt = PAST_GRACE();
  p.lat = lat;
  p.lng = lng;
  p.tailPoints = tailPoints;
  await game.playerStore.set(id, p);
}

// p1's head sits on a segment of p2's tail; heads are far apart so this is
// a head-on-tail kill (victim p1, killer p2), not head-on-head.
async function setupHeadOnTail(game) {
  await game.addPlayer('p1', 'A');
  await game.addPlayer('p2', 'B');
  await placePlayer(game, 'p1', { lat: 51.5, lng: -0.12 });
  await placePlayer(game, 'p2', {
    lat: 51.5005,
    lng: -0.12,
    tailPoints: [{ lat: 51.5, lng: -0.12 }],
  });
}

test('clashAck: unknown clashId is a no-op', async (t) => {
  const { io, game } = makeGame(t, 'ack-bogus');
  await game.addPlayer('p1', 'A');
  game.startMatch();
  freezeTimers(game);

  await game.clashAck('p1', 'bogus-clash-id');

  assert.equal(game._pendingClashes.size, 0);
  assert.equal(
    io._events.filter((e) => e.event === 'snake-hit').length,
    0,
    'no snake-hit for an unknown clashId',
  );
});

test('clashAck: ignored when match is not active', async (t) => {
  const { io, game } = makeGame(t, 'ack-inactive');
  await game.addPlayer('p1', 'A');
  game._pendingClashes.set('c1', {
    victimId: 'p1',
    killerId: null,
    acksNeeded: new Set(['p1']),
    timestamp: Date.now(),
  });
  // Never call startMatch().

  await game.clashAck('p1', 'c1');

  assert.equal(
    game._pendingClashes.has('c1'),
    true,
    'pending clash untouched while inactive',
  );
  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 0);
});

test('clashAck: killer ACKs first — kill still waits for victim ACK', async (t) => {
  const { io, game } = makeGame(t, 'ack-killer-first');
  await setupHeadOnTail(game);
  game.startMatch();
  freezeTimers(game);
  await game._tick();

  const verify = io._events.find((e) => e.event === 'clash_verify');
  assert.ok(verify, 'clash_verify emitted');
  const clashId = verify.payload.clashId;

  await game.clashAck('p2', clashId); // killer ACKs first
  assert.equal(
    io._events.filter((e) => e.event === 'snake-hit').length,
    0,
    'no kill until every participant ACKs',
  );
  assert.equal(game._pendingClashes.has(clashId), true);

  await game.clashAck('p1', clashId); // victim ACKs — commit
  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 1);
  assert.equal(game._pendingClashes.has(clashId), false);
});

test('clashAck: duplicate ACK from the same socket is idempotent', async (t) => {
  const { io, game } = makeGame(t, 'ack-dup');
  await setupHeadOnTail(game);
  game.startMatch();
  freezeTimers(game);
  await game._tick();

  const clashId = io._events.find((e) => e.event === 'clash_verify').payload.clashId;

  await game.clashAck('p1', clashId);
  await game.clashAck('p1', clashId); // duplicate victim ACK

  const pending = game._pendingClashes.get(clashId);
  assert.ok(pending, 'clash still pending — waiting on the killer');
  assert.deepEqual([...pending.acksNeeded], ['p2']);
  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 0);
});

test('_tick: pending clash older than CLASH_ACK_TIMEOUT_MS expires; fresh collisions re-verify', async (t) => {
  const { io, game } = makeGame(t, 'ack-timeout');
  await game.addPlayer('p1', 'A');
  await game.addPlayer('p2', 'B');
  // Players far apart — no fresh collision on the first tick.
  await placePlayer(game, 'p1', { lat: 51.5, lng: -0.12 });
  await placePlayer(game, 'p2', { lat: 51.5005, lng: -0.12 });
  game.startMatch();
  freezeTimers(game);

  game._pendingClashes.set('stale:1', {
    victimId: 'p1',
    killerId: 'p2',
    acksNeeded: new Set(['p1', 'p2']),
    timestamp: Date.now() - CLASH_ACK_TIMEOUT_MS - 1,
  });

  await game._tick();

  assert.equal(
    game._pendingClashes.has('stale:1'),
    false,
    'expired pending clash is removed',
  );
  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 0);

  // A fresh collision after expiry raises a new clash_verify.
  await placePlayer(game, 'p1', { lat: 51.5005, lng: -0.12 }); // move onto p2
  await game._tick();
  const verifies = io._events.filter((e) => e.event === 'clash_verify');
  assert.ok(verifies.length >= 1, 'fresh collision produces a new clash_verify');
  assert.notEqual(verifies[0].payload.clashId, 'stale:1');
});

test('removePlayer: pending clash involving the leaver is cancelled', async (t) => {
  const { io, game } = makeGame(t, 'clash-leaver');
  await setupHeadOnTail(game);
  game.startMatch();
  freezeTimers(game);
  await game._tick();

  const clashId = io._events.find((e) => e.event === 'clash_verify').payload.clashId;
  assert.ok(game._pendingClashes.get(clashId).acksNeeded.has('p2'));

  await game.removePlayer('p2'); // disconnect path

  assert.equal(
    game._pendingClashes.has(clashId),
    false,
    'clash cancelled when a required participant leaves',
  );
  assert.equal(await game.playerStore.get('p2'), undefined);

  await game.clashAck('p1', clashId); // late ACK arrives — nothing happens
  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 0);
});

test('_tick: at most one pending clash per victim (dedup across loop iterations)', async (t) => {
  const { io, game } = makeGame(t, 'clash-dedup');
  await game.addPlayer('p1', 'A');
  await game.addPlayer('p2', 'B');
  // Head-on-head produces duplicate kill entries for each victim across
  // outer-loop iterations — dedup must collapse them.
  await placePlayer(game, 'p1', { lat: 51.5, lng: -0.12 });
  await placePlayer(game, 'p2', { lat: 51.5, lng: -0.12 });
  game.startMatch();
  freezeTimers(game);
  await game._tick();

  const verifies = io._events.filter((e) => e.event === 'clash_verify');
  assert.equal(verifies.length, 2, 'exactly one clash_verify per victim');
  assert.deepEqual(
    verifies.map((e) => e.target).sort(),
    ['p1', 'p2'],
    'each participant verified exactly once',
  );
  assert.equal(game._pendingClashes.size, 2);
});
