import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { makeFakeSocket, socketState } from '../fakeSocket.js';
import SnakeGameScreen from '../../snake/GameScreen.jsx';

const sounds = vi.hoisted(() => ({
  playEat: vi.fn(),
  playDie: vi.fn(),
  playCaptureStart: vi.fn(),
  playCaptureOwned: vi.fn(),
  playShoot: vi.fn(),
  playEnemyShoot: vi.fn(),
  playShield: vi.fn(),
}));

vi.mock('../../socket.js', () => ({
  getSocket: () => socketState.current,
  getSessionId: () => 'sess-test',
  API_BASE: '',
  SERVER_URL: '/',
}));

vi.mock('../../hooks/useSound.js', () => ({ useSound: () => sounds }));

vi.mock('react-leaflet', async () => {
  const React = await import('react');
  return {
    MapContainer: React.forwardRef((props, ref) =>
      React.createElement('div', { 'data-testid': 'map' }, props.children)
    ),
    TileLayer: () => null,
    Marker: () => null,
    CircleMarker: () => null,
    Polyline: () => null,
    Polygon: () => null,
    Tooltip: (props) => props.children ?? null,
    useMap: () => ({ panTo: vi.fn() }),
  };
});

vi.mock('leaflet', () => ({ default: { divIcon: (opts) => opts } }));

let socket;

function baseProps(overrides = {}) {
  return {
    roomId: 'room-1',
    position: null,
    simulate: false,
    simPos: null,
    setSimPos: vi.fn(),
    maxImageryAge: 3,
    maxNativeZoom: 18,
    initialSnapshot: null,
    onLeave: vi.fn(),
    ...overrides,
  };
}

const lastLoc = () => socket._emits('location-update').at(-1)[1];

beforeEach(() => {
  socket = makeFakeSocket({ id: 'me-1', connected: true });
  socketState.current = socket;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('snake GameScreen position effect', () => {
  const food = { id: 'f1', lat: 0, lng: 0.00002 };
  const snap = {
    players: [{ id: 'me-1', name: 'me', color: '#ff0000' }],
    foods: [food],
    scores: {},
    matchActive: true,
  };
  // ~2.2 m steps east.
  const p = (i) => ({ lat: 0, lng: 0.00002 * i, heading: 0 });

  it('eats food within 4 m once, emits eat_food + location-update with tail/score', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const props = baseProps({ position: p(0), initialSnapshot: snap });
    const { rerender } = render(<SnakeGameScreen {...props} />);

    // Spawn grace (3 s) not expired at mount → no eat.
    expect(socket._emits('eat_food')).toHaveLength(0);

    now.mockReturnValue(4000);
    rerender(<SnakeGameScreen {...props} position={p(1)} />);
    expect(socket._emits('eat_food')).toEqual([['eat_food', { foodId: 'f1' }]]);
    expect(sounds.playEat).toHaveBeenCalled();
    expect(lastLoc().score).toBe(1);

    // Same food already claimed locally → no duplicate emit.
    rerender(<SnakeGameScreen {...props} position={p(1)} />);
    expect(socket._emits('eat_food')).toHaveLength(1);

    // Server food-update clears the optimistic claim → re-eat allowed.
    act(() => socket._trigger('food-update', { foods: [food] }));
    rerender(<SnakeGameScreen {...props} position={p(1)} />);
    expect(socket._emits('eat_food')).toHaveLength(2);
    expect(lastLoc().score).toBe(2);
  });

  it('emits clash_ack with the same clashId; non-string ignored', () => {
    render(<SnakeGameScreen {...baseProps({ position: p(0) })} />);
    act(() => socket._trigger('clash_verify', { clashId: 'c1' }));
    expect(socket._emits('clash_ack')).toEqual([
      ['clash_ack', { clashId: 'c1' }],
    ]);
    act(() => socket._trigger('clash_verify', { clashId: 5 }));
    expect(socket._emits('clash_ack')).toHaveLength(1);
  });

  it('snake-reset wipes local tail/score only for the local player', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const props = baseProps({ position: p(0), initialSnapshot: snap });
    const { rerender } = render(<SnakeGameScreen {...props} />);
    now.mockReturnValue(4000);
    rerender(<SnakeGameScreen {...props} position={p(1)} />); // eats f1 → score 1
    rerender(<SnakeGameScreen {...props} position={p(2)} />); // tail grows
    expect(lastLoc().score).toBe(1);
    expect(lastLoc().tailPoints.length).toBeGreaterThan(0);

    // Reset for a different player is ignored.
    act(() => socket._trigger('snake-reset', { playerId: 'other' }));
    rerender(<SnakeGameScreen {...props} position={p(3)} />);
    expect(lastLoc().score).toBe(1);

    // Reset for me → tail + score wiped on the next location-update.
    act(() => socket._trigger('snake-reset', { playerId: 'me-1' }));
    rerender(<SnakeGameScreen {...props} position={p(4)} />);
    expect(lastLoc().score).toBe(0);
    expect(lastLoc().tailPoints).toEqual([]);
  });
});

describe('snake GameScreen WASD sim movement', () => {
  it('updates simPos on key presses', () => {
    const setSimPos = vi.fn();
    const simPos = { lat: 52, lng: 13, heading: 0 };
    render(
      <SnakeGameScreen
        {...baseProps({ simulate: true, simPos, setSimPos, position: simPos })}
      />
    );
    act(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    );
    expect(setSimPos).toHaveBeenCalledTimes(1);
    const updater = setSimPos.mock.calls[0][0];
    expect(updater(simPos)).toEqual({
      lat: 52,
      lng: 13 - 0.00005,
      heading: 0,
    });
  });

  it('ignores keys when simulate is off', () => {
    const setSimPos = vi.fn();
    render(<SnakeGameScreen {...baseProps({ setSimPos })} />);
    act(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    );
    expect(setSimPos).not.toHaveBeenCalled();
  });
});
