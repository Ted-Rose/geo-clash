import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';

function makeIo() {
  const events = [];
  return {
    _events: events,
    to: (id) => ({ emit: (e, p) => events.push({ target: id, event: e, payload: p }) }),
    emit: (e, p) => events.push({ event: e, payload: p }),
  };
}

function freezeTimers(game) {
  if (game._tickHandle) { clearInterval(game._tickHandle); game._tickHandle = null; }
  if (game._foodInterval) { clearInterval(game._foodInterval); game._foodInterval = null; }
}

test('snapshot(): returns the full late-joiner shape', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({
    io,
    roomId: 'snap-test',
    centerLat: 51.5,
    centerLng: -0.12,
    foodCountTarget: 3,
    foodRespawnIntervalMs: 999_999,
    timeLimitMs: 60_000,
  });
  t.after(() => game.endMatch());
  await game.addPlayer('p1', 'Alice');
  game.startMatch();
  freezeTimers(game);

  const before = Date.now();
  const snap = await game.snapshot();

  assert.equal(snap.gameType, 'snake');
  assert.equal(snap.matchActive, true);
  assert.equal(snap.foodCountTarget, 3);
  assert.equal(snap.foodRespawnIntervalMs, 999_999);
  assert.equal(snap.timeLimitMs, 60_000);
  assert.equal(snap.matchStartAt, game._matchStartAt);
  assert.ok(snap.bbox && snap.bbox.south < snap.bbox.north);
  assert.ok(Array.isArray(snap.foods) && snap.foods.length === 3);
  assert.equal(snap.players.length, 1);
  assert.equal(snap.players[0].id, 'p1');
  assert.equal(snap.players[0].name, 'Alice');
  assert.deepEqual(snap.scores.p1, {
    name: 'Alice',
    color: snap.players[0].color,
    score: 0,
    kills: 0,
  });
  assert.ok(
    typeof snap.serverNow === 'number' && snap.serverNow >= before,
    'serverNow is a numeric timestamp',
  );
});

test('publicPlayer: tailPoints defaults to [] when falsy in the store', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({
    io,
    roomId: 'snap-nulltail',
    centerLat: 51.5,
    centerLng: -0.12,
    foodRespawnIntervalMs: 999_999,
  });
  t.after(() => game.endMatch());
  await game.addPlayer('p1', 'Alice');
  const p = await game.playerStore.get('p1');
  p.tailPoints = null;
  await game.playerStore.set('p1', p);
  game.startMatch();
  freezeTimers(game);
  io._events.length = 0;

  await game._tick();

  const update = io._events.find((e) => e.event === 'snake-update');
  assert.deepEqual(update.payload.players[0].tailPoints, []);
});
