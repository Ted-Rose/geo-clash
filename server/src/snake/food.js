// Food spawning helpers for Geo Snake.

import { ulid } from 'ulid';
import { distanceMeters } from '../shared/gridUtils.js';
import { EAT_RADIUS_M, FOOD_COUNT_TARGET } from './constants.js';

// Spawn a food item at a pseudo-random position within the bbox.
export function spawnFood(bbox) {
  const lat = bbox.south + Math.random() * (bbox.north - bbox.south);
  const lng = bbox.west + Math.random() * (bbox.east - bbox.west);
  return { id: ulid(), lat, lng };
}

// Return true if a player head is within EAT_RADIUS_M of the food item.
export function isEaten(head, food, radiusM = EAT_RADIUS_M) {
  return distanceMeters(head, food) <= radiusM;
}

// Replenish the food list so it always has FOOD_COUNT_TARGET items.
export function replenishFood(foods, bbox, target = FOOD_COUNT_TARGET) {
  const out = [...foods];
  while (out.length < target) {
    out.push(spawnFood(bbox));
  }
  return out;
}
