// Collision detection for Geo Snake.
// Brute-force O(n·m) for MVP; spatial index can be added later.

import { distanceMeters } from '../shared/gridUtils.js';
import {
  COLLISION_RADIUS_M,
  NECK_GAP_M,
  SPAWN_GRACE_MS,
} from './constants.js';

// Check whether `head` collides with any segment of `tailPoints`.
// `tailPoints` is an array of { lat, lng } ordered oldest→newest.
// The last few segments (within NECK_GAP_M of the head) are skipped to
// avoid false positives from GPS jitter on the player's own neck.
export function collidesWithTail(head, tailPoints, skipGapM = NECK_GAP_M) {
  if (!tailPoints || tailPoints.length === 0) return false;
  for (let i = tailPoints.length - 1; i >= 0; i--) {
    const seg = tailPoints[i];
    const d = distanceMeters(head, seg);
    if (d < skipGapM) continue;
    if (d <= COLLISION_RADIUS_M) return true;
  }
  return false;
}

// Given a map of players (id → player), resolve all head-on-head or
// head-on-tail collisions. Returns an array of { killerId, victimId }.
export function resolveCollisions(players) {
  const kills = [];
  const entries = Object.values(players).filter(
    (p) => p.alive && !p.inGrace
  );

  for (const p of entries) {
    const head = { lat: p.lat, lng: p.lng };
    const spawnedAt = p.spawnedAt || 0;
    if (Date.now() - spawnedAt < SPAWN_GRACE_MS) {
      p.inGrace = true;
      continue;
    }
    p.inGrace = false;

    for (const other of entries) {
      if (other.id === p.id) continue;
      // Head-on-tail
      if (other.tailPoints && collidesWithTail(head, other.tailPoints, 0)) {
        kills.push({ killerId: other.id, victimId: p.id });
        break;
      }
      // Head-on-head
      const d = distanceMeters(head, { lat: other.lat, lng: other.lng });
      if (d <= COLLISION_RADIUS_M) {
        kills.push({ killerId: null, victimId: p.id });
        kills.push({ killerId: null, victimId: other.id });
        break;
      }
    }
  }
  return kills;
}
