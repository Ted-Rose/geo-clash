import { describe, it, expect } from 'vitest';
import {
  sampleEvenPoints,
  lightenHex,
  distM,
  makeSnakeHeadIcon,
} from '../../snake/SnakeLayer.jsx';

describe('sampleEvenPoints', () => {
  it('spaces markers evenly along a multi-segment path', () => {
    // L-shape: ~111 m east, then ~111 m north.
    const path = [
      [0, 0],
      [0, 0.001],
      [0.001, 0.001],
    ];
    const pts = sampleEvenPoints(path, 5);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[4]).toEqual([0.001, 0.001]);
    // Consecutive samples cover ~equal arc distance.
    const gaps = pts.slice(1).map((p, i) => distM(pts[i], p));
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    for (const g of gaps) {
      expect(g).toBeGreaterThan(avg * 0.9);
      expect(g).toBeLessThan(avg * 1.1);
    }
  });

  it('handles empty/degenerate inputs', () => {
    expect(sampleEvenPoints([], 5)).toEqual([]);
    expect(sampleEvenPoints(null, 5)).toEqual([]);
    expect(sampleEvenPoints([[0, 0]], 0)).toEqual([]);
    expect(sampleEvenPoints([[1, 2]], 5)).toEqual([[1, 2]]);
    expect(sampleEvenPoints([[0, 0], [0, 0]], 3)).toEqual([[0, 0]]);
    const one = sampleEvenPoints([[0, 0], [0, 0.001]], 1);
    expect(one).toHaveLength(1);
    expect(one[0]).toEqual([0, 0]);
  });
});

describe('lightenHex', () => {
  it('blends toward white at amount 0.45', () => {
    expect(lightenHex('#000000')).toBe('rgb(115,115,115)');
    expect(lightenHex('#ff0000')).toBe('rgb(255,115,115)');
    expect(lightenHex('#ffffff')).toBe('rgb(255,255,255)');
  });
});

describe('distM', () => {
  it('computes ~111 m per 0.001 degree of latitude', () => {
    const d = distM([0, 0], [0.001, 0]);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112.5);
  });
});

describe('makeSnakeHeadIcon', () => {
  it('dims and badges a disconnected snake', () => {
    const off = makeSnakeHeadIcon('#ff0000', 0, false, false);
    expect(off.options.html).toContain('reconnecting');
    expect(off.options.html).toContain('grayscale');
    expect(off.options.html).toContain('opacity:0.4');
  });

  it('renders connected/undefined snakes normally', () => {
    for (const connected of [true, undefined]) {
      const on = makeSnakeHeadIcon('#ff0000', 0, false, connected);
      expect(on.options.html).not.toContain('reconnecting');
      expect(on.options.html).not.toContain('grayscale');
    }
  });
});
