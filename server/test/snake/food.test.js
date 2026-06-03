import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnFood, isEaten, replenishFood } from '../../src/snake/food.js';
import { EAT_RADIUS_M, FOOD_COUNT_TARGET, FOOD_SPAWN_RADIUS_M } from '../../src/snake/constants.js';
import { distanceMeters } from '../../src/shared/gridUtils.js';

const center = { lat: 51.501, lng: -0.119 };

test('spawnFood returns a point within the spawn radius', () => {
  const food = spawnFood(center, FOOD_SPAWN_RADIUS_M);
  const dist = distanceMeters(center, food);
  assert.ok(dist <= FOOD_SPAWN_RADIUS_M, `expected dist <= ${FOOD_SPAWN_RADIUS_M}m, got ${dist.toFixed(2)}m`);
  assert.ok(typeof food.id === 'string' && food.id.length > 0);
});

test('isEaten: head within radius returns true', () => {
  const food = { lat: 51.501, lng: -0.119 };
  const head = { lat: 51.501, lng: -0.119 };
  assert.ok(isEaten(head, food));
});

test('isEaten: head far away returns false', () => {
  const food = { lat: 51.501, lng: -0.119 };
  const head = { lat: 51.503, lng: -0.115 };
  assert.equal(isEaten(head, food), false);
});

test('replenishFood brings count up to target', () => {
  const foods = replenishFood([], center, FOOD_SPAWN_RADIUS_M, FOOD_COUNT_TARGET);
  assert.equal(foods.length, FOOD_COUNT_TARGET);
});

test('replenishFood does not add when already at target', () => {
  const seeds = Array.from(
    { length: FOOD_COUNT_TARGET },
    () => spawnFood(center, FOOD_SPAWN_RADIUS_M),
  );
  const result = replenishFood(seeds, center, FOOD_SPAWN_RADIUS_M, FOOD_COUNT_TARGET);
  assert.equal(result.length, FOOD_COUNT_TARGET);
});
