import { describe, it, expect } from 'vitest';
import { idToFreq } from '../../hooks/useSound.js';

describe('idToFreq', () => {
  it('maps the same id deterministically', () => {
    expect(idToFreq('player-1', 320, 720)).toBe(idToFreq('player-1', 320, 720));
  });

  it('returns min for an empty id', () => {
    expect(idToFreq('', 320, 720)).toBe(320);
  });

  it('keeps frequencies within [min, max)', () => {
    for (const id of ['a', 'abc', 'player-1', 'socket-xyz', '12345']) {
      const f = idToFreq(id, 320, 720);
      expect(f).toBeGreaterThanOrEqual(320);
      expect(f).toBeLessThan(720);
      expect(f).toBeGreaterThanOrEqual(0);
    }
  });

  it('produces different frequencies for different ids', () => {
    const freqs = new Set(
      ['a', 'b', 'c', 'd', 'e'].map((id) => idToFreq(id, 320, 720))
    );
    expect(freqs.size).toBeGreaterThan(1);
  });
});
