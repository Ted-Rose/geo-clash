import { describe, it, expect } from 'vitest';
import { buildTail, MAX_TAIL_SEGMENTS } from '../../snake/geo.js';

// ~5.6 m of latitude at the equator.
const STEP = 0.00005;
const line = (n) =>
  Array.from({ length: n }, (_, i) => ({ lat: i * STEP, lng: 0 }));

describe('buildTail', () => {
  it('returns [] when score is 0', () => {
    expect(buildTail(line(3), { lat: 0.001, lng: 0 }, 0)).toEqual([]);
  });

  it('trims the tail to score*5 meters, oldest points first', () => {
    // Each segment is ~5.6 m; score 2 → maxLen 10 m → only the last
    // ~5.6 m segment fits, so the oldest point is dropped.
    const tail = line(2);
    const next = { lat: 2 * STEP, lng: 0 };
    const out = buildTail(tail, next, 2);
    expect(out).toEqual([tail[1], next]);
  });

  it('keeps the whole tail when under the length cap', () => {
    const tail = line(2);
    const next = { lat: 2 * STEP, lng: 0 };
    const out = buildTail(tail, next, 10); // 50 m cap, ~20 m tail
    expect(out).toEqual([...tail, next]);
  });

  it('caps at MAX_TAIL_SEGMENTS keeping the newest points', () => {
    // Tiny segments so the length cap doesn't trim anything.
    const tail = Array.from({ length: 210 }, (_, i) => ({
      lat: i * 0.0000009, // ~0.1 m
      lng: 0,
    }));
    const next = { lat: 210 * 0.0000009, lng: 0 };
    const out = buildTail(tail, next, 100);
    expect(out).toHaveLength(MAX_TAIL_SEGMENTS);
    expect(out[out.length - 1]).toEqual(next);
    // Order preserved oldest→newest.
    expect(out[0].lat).toBeLessThan(out[1].lat);
  });

  it('preserves oldest→newest ordering', () => {
    const out = buildTail(line(4), { lat: 4 * STEP, lng: 0 }, 100);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].lat).toBeGreaterThan(out[i - 1].lat);
    }
  });
});
