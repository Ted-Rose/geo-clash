import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';
import { FOOD_SCORE_PER_ITEM } from '../../src/snake/constants.js';

// Eating is client-reported: the client emits `eat_food` and the server
// runs `game.eatFood(playerId, foodId)`. _tick never inspects food
// proximity — the old server-side proximity-eat model is gone.

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

test('eatFood: first claim removes food, awards point, emits snake-ate + food-update', async (t) => {
  const { io, game } = makeGame(t, 'eat-first');
  game._foods = [{ id: 'food1', lat: 51.5, lng: -0.12 }];
  await game.addPlayer('p1', 'Alice');
  game.startMatch();
  freezeTimers(game);

  await game.eatFood('p1', 'food1');

  assert.equal(game._foods.length, 0, 'food1 must be removed from the live list');
  const p = await game.playerStore.get('p1');
  assert.equal(p.score, FOOD_SCORE_PER_ITEM);

  const ate = io._events.find((e) => e.event === 'snake-ate');
  assert.ok(ate, 'snake-ate event emitted');
  assert.deepEqual(
    { playerId: ate.payload.playerId, foodId: ate.payload.foodId, score: ate.payload.score },
    { playerId: 'p1', foodId: 'food1', score: FOOD_SCORE_PER_ITEM },
  );
  const foodUpdate = io._events.find((e) => e.event === 'food-update');
  assert.ok(foodUpdate, 'food-update event emitted after first claim');
  assert.equal(foodUpdate.payload.foods.length, 0);
});

test('eatFood: second player reporting same foodId inside race window still scores', async (t) => {
  const { io, game } = makeGame(t, 'eat-race');
  game._foods = [{ id: 'food1', lat: 51.5, lng: -0.12 }];
  await game.addPlayer('p1', 'Alice');
  await game.addPlayer('p2', 'Bob');
  game.startMatch();
  freezeTimers(game);

  await game.eatFood('p1', 'food1');
  await game.eatFood('p2', 'food1');

  // Double-award is the deliberate race-tolerance contract.
  const p2 = await game.playerStore.get('p2');
  assert.equal(p2.score, FOOD_SCORE_PER_ITEM);
  assert.equal(game._foods.length, 0, 'food list unchanged on second claim');

  const ates = io._events.filter((e) => e.event === 'snake-ate');
  assert.equal(ates.length, 2, 'a snake-ate is emitted per reporting player');
});

test('eatFood: unknown foodId never seen still awards point (unconditional award)', async (t) => {
  const { io, game } = makeGame(t, 'eat-unknown');
  game._foods = [{ id: 'real-food', lat: 51.5, lng: -0.12 }];
  await game.addPlayer('p1', 'Alice');
  game.startMatch();
  freezeTimers(game);

  await game.eatFood('p1', 'never-existed');

  const p = await game.playerStore.get('p1');
  assert.equal(p.score, FOOD_SCORE_PER_ITEM);
  const ate = io._events.find((e) => e.event === 'snake-ate');
  assert.ok(ate, 'snake-ate still emitted for unknown foodId');
  // No food-update: nothing was removed from the live list.
  assert.equal(
    io._events.filter((e) => e.event === 'food-update').length,
    0,
    'food-update only fires when a live food item is removed',
  );
  assert.equal(game._foods.length, 1, 'live food list untouched');
});

test('eatFood: no-op when match not active', async (t) => {
  const { io, game } = makeGame(t, 'eat-inactive');
  game._foods = [{ id: 'food1', lat: 51.5, lng: -0.12 }];
  await game.addPlayer('p1', 'Alice');
  // Never call startMatch() — matchActive stays false.

  await game.eatFood('p1', 'food1');

  const p = await game.playerStore.get('p1');
  assert.equal(p.score, 0);
  assert.equal(game._foods.length, 1);
  assert.equal(
    io._events.filter((e) => e.event === 'snake-ate' || e.event === 'food-update').length,
    0,
    'no events emitted while the match is inactive',
  );
});

test('eatFood: no-op for unknown player id', async (t) => {
  const { io, game } = makeGame(t, 'eat-ghost');
  game._foods = [{ id: 'food1', lat: 51.5, lng: -0.12 }];
  game.startMatch();
  freezeTimers(game);

  await game.eatFood('ghost', 'food1');

  assert.equal(await game.playerStore.get('ghost'), undefined);
  assert.equal(game._foods.length, 1, 'live food untouched by ghost claim');
  assert.equal(
    io._events.filter((e) => e.event === 'snake-ate' || e.event === 'food-update').length,
    0,
    'no events emitted for unknown player',
  );
});

test('eatFood: stale _recentlyEaten entries (> EAT_RACE_WINDOW_MS) are purged', async (t) => {
  const { game } = makeGame(t, 'eat-purge');
  game._foods = [{ id: 'live1', lat: 51.5, lng: -0.12 }];
  await game.addPlayer('p1', 'Alice');
  game.startMatch();
  freezeTimers(game);

  // EAT_RACE_WINDOW_MS is 3000 (module-private); seed well past it.
  game._recentlyEaten.set('old-food', Date.now() - 4000);

  await game.eatFood('p1', 'live1');

  assert.equal(game._recentlyEaten.has('old-food'), false, 'stale entry purged');
  assert.equal(game._recentlyEaten.has('live1'), true, 'fresh claim recorded');
});
