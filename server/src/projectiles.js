// Pure functions for the deterministic projectile telemetry model. The
// server commits a (origin, target, vMps, tSpawn, tArrival) packet exactly
// once per shot; clients extrapolate the position locally. See
// feature-plan.md §4 for the design.

import { ulid } from 'ulid';
import { distanceMeters } from './gridUtils.js';

export const PROJECTILE_VMPS = 5;       // m/s
export const HIT_RADIUS_M = 1.5;        // around the committed target point
export const ATTACK_RANGE_M = 30;       // arrows fly ~30m
export const AUTO_AIM_CONE_DEG = 25;    // for cone fallback when no target

export function spawnProjectile({ attacker, target, vMps = PROJECTILE_VMPS, now = Date.now() }) {
  const origin = { lat: attacker.lat, lng: attacker.lng };
  const dist = distanceMeters(origin, target);
  const tArrival = now + (dist / vMps) * 1000;
  return {
    id: ulid(),
    attackerId: attacker.id,
    origin,
    target,
    vMps,
    tSpawn: now,
    tArrival,
    status: 'in-flight',
  };
}

export function isExpired(p, now = Date.now()) {
  return now >= p.tArrival;
}

// Project a target point at `range` meters along the heading from origin.
// Used as the fallback when the client doesn't supply an explicit target.
export function targetFromHeading(origin, headingDeg, rangeM = ATTACK_RANGE_M) {
  const RAD = Math.PI / 180;
  const dLat = (rangeM / 111320) * Math.cos(headingDeg * RAD);
  const dLng =
    (rangeM / (111320 * Math.cos(origin.lat * RAD))) *
    Math.sin(headingDeg * RAD);
  return { lat: origin.lat + dLat, lng: origin.lng + dLng };
}
