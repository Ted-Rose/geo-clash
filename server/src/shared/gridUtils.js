// Shared geo helpers (pure math only).
// At the scales we care about (<1 km play area), a local equirectangular
// approximation is plenty accurate and far simpler than full geodesics.

export const EARTH_R = 6378137; // meters
export const DEG = Math.PI / 180;

// meters → degrees at a given latitude
export function metersToDegLat(m) {
  return (m / EARTH_R) * (180 / Math.PI);
}
export function metersToDegLng(m, atLat) {
  return (m / (EARTH_R * Math.cos(atLat * DEG))) * (180 / Math.PI);
}

// Haversine distance, meters
export function distanceMeters(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

// Build a centered square bbox of `sideMeters` around (lat,lng).
export function bboxAround(lat, lng, sideMeters = 120) {
  const half = sideMeters / 2;
  const dLat = metersToDegLat(half);
  const dLng = metersToDegLng(half, lat);
  return {
    south: lat - dLat,
    north: lat + dLat,
    west: lng - dLng,
    east: lng + dLng,
  };
}
