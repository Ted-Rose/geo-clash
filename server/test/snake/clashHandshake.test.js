import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';
import {
  CLASH_ACK_TIMEOUT_MS,
  SPAWN_GRACE_MS,
} from '../../src/snake/constants.js';

function makeIo() {
  const events = [];
  return {
    _events: events,
    to: (id) => ({
      emit: (e, p) => events.push({ target: id, event: e, payload: p }),
    }),
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
  if (game._tickHandle) {
    clearInterval(game._tickHandle);
    game._tickHandle = null;
  }
  if (game._foodInterval) {
    clearInterval(game._foodInterval);
    game._foodInterval = null;
  }
}

const PAST_GRACE = () => Date.now() - SPAWN_GRACE_MS - 100;

async function placePlayer(game, id, { lat, lng, tailPoints = [], score }) {
  const p = await game.playerStore.get(id);
  p.spawnedAt = PAST_GRACE();
  p.lat = lat;
  p.lng = lng;
  p.tailPoints = tailPoints;
  if (typeof score === 'number') p.score = score;
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

test('clashAck: killer ACK alone commits the kill', async (t) => {
  const { io, game } = makeGame(t, 'ack-killer-first');
  await setupHeadOnTail(game);
  game.startMatch();
  freezeTimers(game);
  await game._tick();

  const verify = io._events.find((e) => e.event === 'clash_verify');
  assert.ok(verify, 'clash_verify emitted');
  const clashId = verify.payload.clashId;

  await game.clashAck('p2', clashId); // killer ACKs — kill commits now
  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 1);
  assert.equal(game._pendingClashes.has(clashId), false);

  const killer = await game.playerStore.get('p2');
  assert.equal(killer.kills, 1, 'killer credited on its own ACK');
  assert.equal(killer.score, 5);
  const victim = await game.playerStore.get('p1');
  assert.equal(victim.score, 0, 'victim score reset');
  assert.deepEqual(victim.tailPoints, [], 'victim tail cleared');

  // The victim's late ACK is a no-op — the clash is already committed.
  await game.clashAck('p1', clashId);
  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 1);
});

test('clashAck: victim silence cannot dodge the kill', async (t) => {
  const { io, game } = makeGame(t, 'ack-victim-silent');
  await setupHeadOnTail(game);
  game.startMatch();
  freezeTimers(game);
  await game._tick();

  const clashId =
    io._events.find((e) => e.event === 'clash_verify').payload.clashId;

  // Victim goes silent (times out); only the killer ACKs.
  await game.clashAck('p2', clashId);

  assert.equal(
    io._events.filter((e) => e.event === 'snake-hit').length,
    1,
    'kill commits without the victim ACK',
  );
  const victim = await game.playerStore.get('p1');
  assert.equal(victim.score, 0, 'silent victim still reset');
});

test('clashAck: victim disconnect cannot dodge the kill', async (t) => {
  const { io, game } = makeGame(t, 'ack-victim-leave');
  await setupHeadOnTail(game);
  game.startMatch();
  freezeTimers(game);
  await game._tick();

  const clashId =
    io._events.find((e) => e.event === 'clash_verify').payload.clashId;

  await game.removePlayer('p1'); // victim hard-leaves before ACKing
  assert.equal(
    game._pendingClashes.has(clashId),
    true,
    'victim leaving does not cancel the pending clash',
  );

  await game.clashAck('p2', clashId); // killer ACKs — kill commits

  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 1);
  const killer = await game.playerStore.get('p2');
  assert.equal(killer.kills, 1, 'killer credited even with victim gone');
  assert.equal(killer.score, 5);
});

test(
  'clashAck: killer ACK after the window is treated as expired',
  async (t) => {
  const { io, game } = makeGame(t, 'ack-late');
  await setupHeadOnTail(game);
  game.startMatch();
  freezeTimers(game);
  await game._tick();

  const clashId =
    io._events.find((e) => e.event === 'clash_verify').payload.clashId;

  // Age the pending entry past the ACK window, then ACK before the next
  // _tick expiry sweep — the late ACK must drop the clash, not commit.
  game._pendingClashes.get(clashId).timestamp =
    Date.now() - CLASH_ACK_TIMEOUT_MS - 1;
  await game.clashAck('p2', clashId);

  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 0);
  assert.equal(
    game._pendingClashes.has(clashId),
    false,
    'late ACK drops the expired clash instead of committing',
  );
  const killer = await game.playerStore.get('p2');
  assert.equal(killer.kills, 0, 'late killer ACK earns nothing');
  },
);

test('clashAck: killer timeout voids the clash', async (t) => {
  const { io, game } = makeGame(t, 'ack-killer-timeout');
  await setupHeadOnTail(game);
  game.startMatch();
  freezeTimers(game);
  await game._tick();

  const clashId =
    io._events.find((e) => e.event === 'clash_verify').payload.clashId;

  // Victim ACKs (advisory) — the killer stays silent.
  await game.clashAck('p1', clashId);
  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 0);
  assert.equal(game._pendingClashes.has(clashId), true);

  // Separate the players so the expiry tick raises no fresh clash,
  // then age the pending entry past the ACK window.
  await placePlayer(game, 'p2', { lat: 51.501, lng: -0.12, tailPoints: [] });
  game._pendingClashes.get(clashId).timestamp =
    Date.now() - CLASH_ACK_TIMEOUT_MS - 1;
  await game._tick();

  assert.equal(
    game._pendingClashes.has(clashId),
    false,
    'expired pending clash is dropped',
  );
  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 0);
  const killer = await game.playerStore.get('p2');
  assert.equal(killer.kills, 0, 'silent killer earns nothing');
});

test('clashAck: duplicate ACK from one socket is idempotent', async (t) => {
  const { io, game } = makeGame(t, 'ack-dup');
  await setupHeadOnTail(game);
  game.startMatch();
  freezeTimers(game);
  await game._tick();

  const clashId =
    io._events.find((e) => e.event === 'clash_verify').payload.clashId;

  await game.clashAck('p1', clashId);
  await game.clashAck('p1', clashId); // duplicate victim ACK (advisory)

  const pending = game._pendingClashes.get(clashId);
  assert.ok(pending, 'clash still pending — waiting on the killer');
  assert.deepEqual(
    [...pending.acksNeeded],
    ['p2'],
    'acksNeeded holds only the deciding participant (the killer)',
  );
  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 0);
});

test('_tick: expired clash drops; fresh collisions re-verify', async (t) => {
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
  assert.ok(
    verifies.length >= 1,
    'fresh collision produces a new clash_verify',
  );
  assert.notEqual(verifies[0].payload.clashId, 'stale:1');
});

test('removePlayer: killer leaving cancels the pending clash', async (t) => {
  const { io, game } = makeGame(t, 'clash-leaver');
  await setupHeadOnTail(game);
  game.startMatch();
  freezeTimers(game);
  await game._tick();

  const clashId =
    io._events.find((e) => e.event === 'clash_verify').payload.clashId;
  assert.ok(game._pendingClashes.get(clashId).acksNeeded.has('p2'));

  await game.removePlayer('p2'); // disconnect path

  assert.equal(
    game._pendingClashes.has(clashId),
    false,
    'clash cancelled when the deciding participant leaves',
  );
  assert.equal(await game.playerStore.get('p2'), undefined);

  await game.clashAck('p1', clashId); // late ACK arrives — nothing happens
  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 0);
});

test(
  '_tick: dedup — one committed kill per victim on head-on-head',
  async (t) => {
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
  // Killerless kills commit at detection — nothing stays pending, and
  // the duplicated kill entries collapse to one commit per victim.
  assert.equal(game._pendingClashes.size, 0);
  const hits = io._events.filter((e) => e.event === 'snake-hit');
  assert.equal(hits.length, 2, 'one committed kill per victim');
  },
);

test(
  'killerless head-on-head commits at detection — silence ' +
    'or disconnect cannot dodge',
  async (t) => {
  const { io, game } = makeGame(t, 'headon-commit');
  await game.addPlayer('p1', 'A');
  await game.addPlayer('p2', 'B');
  // Same spot with tails far from both heads → mutual head-on-head
  // (two killerless kills), observable via the score/tail wipe.
  await placePlayer(game, 'p1', {
    lat: 51.5,
    lng: -0.12,
    tailPoints: [{ lat: 51.51, lng: -0.12 }],
    score: 7,
  });
  await placePlayer(game, 'p2', {
    lat: 51.5,
    lng: -0.12,
    tailPoints: [{ lat: 51.52, lng: -0.12 }],
    score: 9,
  });
  game.startMatch();
  freezeTimers(game);
  await game._tick();

  // No ack is needed — nothing is left pending.
  assert.equal(game._pendingClashes.size, 0);
  const hits = io._events.filter((e) => e.event === 'snake-hit');
  assert.equal(hits.length, 2, 'both kills commit at detection');
  assert.deepEqual(
    hits.map((e) => e.payload.victimId).sort(),
    ['p1', 'p2'],
  );
  assert.ok(hits.every((e) => e.payload.killerId === null));

  const resets = io._events.filter((e) => e.event === 'snake-reset');
  assert.deepEqual(
    resets.map((e) => e.target).sort(),
    ['p1', 'p2'],
    'each victim socket gets its own snake-reset',
  );
  for (const id of ['p1', 'p2']) {
    const p = await game.playerStore.get(id);
    assert.equal(p.score, 0, `${id} score reset`);
    assert.deepEqual(p.tailPoints, [], `${id} tail wiped`);
    assert.ok(
      Date.now() - p.spawnedAt < SPAWN_GRACE_MS,
      `${id} respawned inside the grace window`,
    );
  }

  // The old dodge: a victim who hard-leaves or never acks — the kills
  // are already committed, so there is nothing left to void.
  await game.removePlayer('p2');
  assert.equal(game._pendingClashes.size, 0);
  const clashId =
    io._events.find((e) => e.event === 'clash_verify').payload.clashId;
  await game.clashAck('p1', clashId); // late ack for a dead clash
  assert.equal(
    io._events.filter((e) => e.event === 'snake-hit').length,
    2,
    'late acks and disconnects change nothing',
  );
  },
);
