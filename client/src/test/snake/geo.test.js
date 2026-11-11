import { describe, it, expect } from 'vitest';
import { distanceMeters } from '../../snake/geo.js';

describe('distanceMeters', () => {
  it('returns 0 for the same point', () => {
    const p = { lat: 52.5, lng: 13.4 };
    expect(distanceMeters(p, p)).toBe(0);
  });

  it('matches ~111.32 km per degree of latitude at the equator', () => {
    const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_500);
  });

  it('is symmetric', () => {
    const a = { lat: 52.5, lng: 13.4 };
    const b = { lat: 48.8, lng: 2.35 };
    expect(distanceMeters(a, b)).toBe(distanceMeters(b, a));
  });
});
