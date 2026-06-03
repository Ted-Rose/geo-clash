// Food spawning helpers for Geo Snake.

import { ulid } from 'ulid';
import { distanceMeters, metersToDegLat, metersToDegLng } from '../shared/gridUtils.js';
import { EAT_RADIUS_M, FOOD_COUNT_TARGET, FOOD_SPAWN_RADIUS_M } from './constants.js';

// Spawn a food item at a pseudo-random position within radiusM of center.
export function spawnFood(center, radiusM = FOOD_SPAWN_RADIUS_M) {
  const angle = Math.random() * 2 * Math.PI;
  const dist = Math.sqrt(Math.random()) * radiusM;
  const lat = center.lat + metersToDegLat(dist * Math.cos(angle));
  const lng = center.lng + metersToDegLng(dist * Math.sin(angle), center.lat);
  return { id: ulid(), lat, lng };
}

// Return true if a player head is within EAT_RADIUS_M of the food item.
export function isEaten(head, food, radiusM = EAT_RADIUS_M) {
  return distanceMeters(head, food) <= radiusM;
}

// Replenish the food list so it always has target items.
export function replenishFood(foods, center, radiusM, target = FOOD_COUNT_TARGET) {
  const out = [...foods];
  while (out.length < target) {
    out.push(spawnFood(center, radiusM));
  }
  return out;
}
