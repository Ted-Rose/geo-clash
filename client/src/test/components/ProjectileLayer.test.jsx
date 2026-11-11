import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import ProjectileLayer from '../../components/ProjectileLayer.jsx';

const captured = vi.hoisted(() => ({ markers: [], lines: [] }));

vi.mock('react-leaflet', () => ({
  Marker: (props) => {
    captured.markers.push(props);
    return null;
  },
  Polyline: (props) => {
    captured.lines.push(props);
    return null;
  },
}));

vi.mock('leaflet', () => ({ default: { divIcon: (opts) => opts } }));

const T = 1_000_000;

const proj = (over = {}) => ({
  id: 'p1',
  attackerId: 'a',
  origin: { lat: 0, lng: 0 },
  target: { lat: 0, lng: 0.002 },
  tSpawn: T - 500,
  tArrival: T + 500,
  ...over,
});

beforeEach(() => {
  captured.markers = [];
  captured.lines = [];
  vi.spyOn(Date, 'now').mockReturnValue(T);
  // Stop the rAF re-render loop — one render is enough to inspect positions.
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ProjectileLayer', () => {
  it('prunes expired projectiles', () => {
    render(
      <ProjectileLayer
        projectiles={[proj({ id: 'dead', tArrival: T - 1 })]}
        skewMs={0}
      />
    );
    expect(captured.markers).toHaveLength(0);
  });

  it('prunes projectiles spawning more than 500 ms in the future', () => {
    render(
      <ProjectileLayer
        projectiles={[proj({ id: 'late', tSpawn: T + 600, tArrival: T + 1600 })]}
        skewMs={0}
      />
    );
    expect(captured.markers).toHaveLength(0);
  });

  it('lerps position and computes heading for mid-flight rockets', () => {
    render(<ProjectileLayer projectiles={[proj()]} skewMs={0} />);
    expect(captured.markers).toHaveLength(1);
    const m = captured.markers[0];
    // u = 0.5 → midpoint of (0,0) → (0,0.002)
    expect(m.position[0]).toBeCloseTo(0, 6);
    expect(m.position[1]).toBeCloseTo(0.001, 6);
    // Due east → heading 90.
    expect(m.icon.html).toContain('rotate(90deg)');
    // Exhaust trail ends at the rocket position.
    const line = captured.lines[0];
    expect(line.positions[1]).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(0.001, 6),
    ]);
  });

  it('honours skewMs when comparing against server time', () => {
    // Server clock is 1000 ms ahead → a rocket expiring at T+500 is
    // already resolved server-side.
    render(<ProjectileLayer projectiles={[proj()]} skewMs={1000} />);
    expect(captured.markers).toHaveLength(0);
  });
});
