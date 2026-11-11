// Pure geo + tail helpers for the snake mode. Extracted from
// snake/GameScreen.jsx so the client-authoritative tail/eat rules are unit
// testable without mounting the screen (mirrors server/src/snake/ splitting
// pure math from the state module).
//
// Game constants (must match server/src/snake/constants.js)
export const MIN_MOVE_M = 1.5;
export const EAT_RADIUS_M = 4.0;
export const TAIL_METERS_PER_SCORE = 5;
export const MAX_TAIL_SEGMENTS = 200;

// Haversine distance in meters between two {lat, lng} points
const _DEG = Math.PI / 180;
const _EARTH_R = 6378137;
export function distanceMeters(a, b) {
  const dLat = (b.lat - a.lat) * _DEG;
  const dLng = (b.lng - a.lng) * _DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * _DEG) * Math.cos(b.lat * _DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * _EARTH_R * Math.asin(Math.sqrt(s));
}

// Append newPoint (last head position) to the tail and trim to allowed length.
// tail is [{lat,lng}] ordered oldest→newest (tail tip first).
export function buildTail(tail, newPoint, score) {
  const maxLen = score * TAIL_METERS_PER_SCORE;
  if (maxLen <= 0) return [];
  const updated = [...tail, newPoint];
  // Compute total length, then strip oldest segments from the front
  let totalDist = 0;
  for (let i = 1; i < updated.length; i++) {
    totalDist += distanceMeters(updated[i - 1], updated[i]);
  }
  let start = 0;
  while (totalDist > maxLen && start < updated.length - 1) {
    totalDist -= distanceMeters(updated[start], updated[start + 1]);
    start++;
  }
  const trimmed = updated.slice(start);
  return trimmed.length > MAX_TAIL_SEGMENTS
    ? trimmed.slice(trimmed.length - MAX_TAIL_SEGMENTS)
    : trimmed;
}
