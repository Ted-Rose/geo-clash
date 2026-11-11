import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';
import { SPAWN_GRACE_MS } from '../../src/snake/constants.js';

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
  });
  t.after(() => game.endMatch());
  return { io, game };
}

test('_killPlayer: victim is reset in place (score→0, tail cleared, spawnedAt refreshed, stays alive)', async (t) => {
  const { game } = makeGame(t, 'kill-reset');
  await game.addPlayer('v', 'Victim');
  await game.addPlayer('k', 'Killer');

  const v = await game.playerStore.get('v');
  v.score = 9;
  v.tailPoints = [{ lat: 51.5, lng: -0.12 }];
  v.spawnedAt = Date.now() - 60_000;
  await game.playerStore.set('v', v);

  const before = Date.now();
  await game._killPlayer('v', 'k');

  const after = await game.playerStore.get('v');
  assert.equal(after.score, 0);
  assert.deepEqual(after.tailPoints, []);
  assert.equal(after.alive, true, 'victim respawns — alive stays true');
  assert.ok(
    after.spawnedAt >= before && after.spawnedAt <= Date.now(),
    'spawnedAt refreshed so the victim re-enters spawn grace',
  );
  assert.ok(
    Date.now() - after.spawnedAt < SPAWN_GRACE_MS,
    'victim is inside the grace window immediately after being killed',
  );
});

test('_killPlayer: killer is credited kills+1 and score+5', async (t) => {
  const { game } = makeGame(t, 'kill-credit');
  await game.addPlayer('v', 'Victim');
  await game.addPlayer('k', 'Killer');

  const k = await game.playerStore.get('k');
  k.score = 3;
  k.kills = 0;
  await game.playerStore.set('k', k);

  await game._killPlayer('v', 'k');

  const after = await game.playerStore.get('k');
  assert.equal(after.kills, 1);
  assert.equal(after.score, 8);
});

test('_killPlayer: emits room-scoped snake-hit and snake-reset only to the victim socket', async (t) => {
  const { io, game } = makeGame(t, 'kill-events');
  await game.addPlayer('v', 'Victim');
  await game.addPlayer('k', 'Killer');

  await game._killPlayer('v', 'k');

  const hit = io._events.find((e) => e.event === 'snake-hit');
  assert.ok(hit, 'snake-hit emitted');
  assert.equal(hit.target, 'kill-events', 'snake-hit is broadcast to the room');
  assert.deepEqual(hit.payload, { victimId: 'v', killerId: 'k' });

  const resets = io._events.filter((e) => e.event === 'snake-reset');
  assert.equal(resets.length, 1, 'exactly one snake-reset');
  assert.equal(resets[0].target, 'v', 'snake-reset goes only to the victim socket');
  const victim = await game.playerStore.get('v');
  assert.equal(resets[0].payload.spawnedAt, victim.spawnedAt);
});

test('_killPlayer: killerId null (head-on-head) — no killer lookup, payload killerId null', async (t) => {
  const { io, game } = makeGame(t, 'kill-null');
  await game.addPlayer('v', 'Victim');
  await game.addPlayer('other', 'Other');
  const o = await game.playerStore.get('other');
  o.score = 4;
  o.kills = 2;
  await game.playerStore.set('other', o);

  await game._killPlayer('v', null);

  const hit = io._events.find((e) => e.event === 'snake-hit');
  assert.deepEqual(hit.payload, { victimId: 'v', killerId: null });
  const after = await game.playerStore.get('other');
  assert.equal(after.score, 4, 'nobody is credited when killerId is null');
  assert.equal(after.kills, 2);
});

test('_killPlayer: unknown victim id is a no-op', async (t) => {
  const { io, game } = makeGame(t, 'kill-ghost');
  await game._killPlayer('ghost', 'k');
  assert.equal(io._events.filter((e) => e.event === 'snake-hit').length, 0);
});
