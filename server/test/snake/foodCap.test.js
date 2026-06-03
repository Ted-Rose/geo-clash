import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';
import { replenishFood } from '../../src/snake/food.js';
import { FOOD_SPAWN_RADIUS_M } from '../../src/snake/constants.js';

function makeIo() {
  const events = [];
  return {
    _events: events,
    to: () => ({ emit: (e, p) => events.push({ event: e, payload: p }) }),
    emit: (e, p) => events.push({ event: e, payload: p }),
  };
}

const CENTER = { lat: 51.5, lng: -0.12 };

test('foodCountTarget=2 never spawns more than 2 items', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({
    io,
    roomId: 'food-cap-test',
    centerLat: 51.5,
    centerLng: -0.12,
    arenaSideMeters: 200,
    foodCountTarget: 2,
    foodRespawnIntervalMs: 999_999,
  });
  t.after(() => game.endMatch());

  game._foods = [];
  game.startMatch();

  assert.ok(
    game._foods.length <= 2,
    `initial food count should be <= 2, got ${game._foods.length}`
  );

  // Simulate the interval callback: replenish from empty to target
  game._foods = [];
  game._foods = replenishFood(
    game._foods, game._foodSpawnCenter, FOOD_SPAWN_RADIUS_M, game._foodCountTarget,
  );
  assert.equal(game._foods.length, 2, 'replenish from zero should produce exactly 2');

  // Replenishing when already at cap should not exceed cap
  game._foods = replenishFood(
    game._foods, game._foodSpawnCenter, FOOD_SPAWN_RADIUS_M, game._foodCountTarget,
  );
  assert.equal(game._foods.length, 2, 'replenish at cap should stay at 2');
});
