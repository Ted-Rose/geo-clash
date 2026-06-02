import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnFood, isEaten, replenishFood } from '../../src/snake/food.js';
import { EAT_RADIUS_M, FOOD_COUNT_TARGET } from '../../src/snake/constants.js';

const bbox = { south: 51.5, north: 51.502, west: -0.12, east: -0.118 };

test('spawnFood returns a point inside the bbox', () => {
  const food = spawnFood(bbox);
  assert.ok(food.lat >= bbox.south && food.lat <= bbox.north);
  assert.ok(food.lng >= bbox.west && food.lng <= bbox.east);
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
  const foods = replenishFood([], bbox, FOOD_COUNT_TARGET);
  assert.equal(foods.length, FOOD_COUNT_TARGET);
});

test('replenishFood does not add when already at target', () => {
  const seeds = Array.from({ length: FOOD_COUNT_TARGET }, () => spawnFood(bbox));
  const result = replenishFood(seeds, bbox, FOOD_COUNT_TARGET);
  assert.equal(result.length, FOOD_COUNT_TARGET);
});
