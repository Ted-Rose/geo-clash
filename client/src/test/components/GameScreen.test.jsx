import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { makeFakeSocket, socketState } from '../fakeSocket.js';
import GameScreen from '../../clash/GameScreen.jsx';

const mapProps = vi.hoisted(() => ({ calls: [] }));
const projProps = vi.hoisted(() => ({ calls: [] }));
const botSockets = vi.hoisted(() => ({ list: [] }));
const sounds = vi.hoisted(() => ({
  playEat: vi.fn(),
  playDie: vi.fn(),
  playCaptureStart: vi.fn(),
  playCaptureOwned: vi.fn(),
  playShoot: vi.fn(),
  playEnemyShoot: vi.fn(),
  playShield: vi.fn(),
}));

vi.mock('../../shared/socket.js', () => ({
  getSocket: () => socketState.current,
  getSessionId: () => 'sess-test',
  API_BASE: '',
  SERVER_URL: '/',
}));

vi.mock('../../shared/hooks/useSound.js', () => ({ useSound: () => sounds }));

// spawnBot() dynamically imports socket.io-client; hand it fake sockets
// so the test can assert disconnect on unmount.
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    const s = {
      id: `bot-${botSockets.list.length}`,
      on: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    botSockets.list.push(s);
    return s;
  }),
}));

vi.mock('../../shared/MapView.jsx', async () => {
  const React = await import('react');
  return {
    default: (props) => {
      mapProps.calls.push(props);
      return React.createElement(
        'div',
        { 'data-testid': 'mapview' },
        props.children
      );
    },
  };
});

vi.mock('../../clash/ProjectileLayer.jsx', () => ({
  default: (props) => {
    projProps.calls.push(props);
    return null;
  },
}));

vi.mock('react-leaflet', async () => {
  const React = await import('react');
  return {
    CircleMarker: (props) =>
      React.createElement('div', null, props.children),
    Tooltip: (props) => props.children ?? null,
  };
});

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
    reconnectSnap: null,
    connected: true,
    onLeave: vi.fn(),
    ...overrides,
  };
}

const grid = {
  baseCellId: 'base',
  bbox: { south: 0, west: 0, north: 0.001, east: 0.001 },
  cells: [
    {
      id: 'base',
      polygon: [
        [0, 0],
        [0, 0.0005],
        [0.0005, 0.0005],
        [0.0005, 0],
      ],
    },
    {
      id: 'c2',
      polygon: [
        [0, 0.0005],
        [0, 0.001],
        [0.0005, 0.001],
        [0.0005, 0.0005],
      ],
    },
  ],
};

const snapshot = {
  grid,
  ownership: [
    { id: 'base', ownerId: 'p1' },
    { id: 'c2', ownerId: 'p2' },
  ],
  players: [{ id: 'socket-1', name: 'me', color: '#fff', lives: 3, ammo: 3 }],
  scores: { p1: { name: 'P1', squares: 1, color: '#f00' } },
  remainingSeconds: 120,
  serverNow: 0,
};

const latestMap = () => mapProps.calls.at(-1);
const latestProj = () => projProps.calls.at(-1);

beforeEach(() => {
  socket = makeFakeSocket({ id: 'socket-1', connected: true });
  socketState.current = socket;
  mapProps.calls = [];
  projProps.calls = [];
  botSockets.list = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('clash GameScreen socket wiring', () => {
  it('grid-update merges cells by id and keeps prior ownership', () => {
    render(
      <GameScreen {...baseProps({ initialSnapshot: snapshot })} />
    );
    expect(latestMap().ownership).toHaveLength(2);

    act(() =>
      socket._trigger('grid-update', {
        cells: [{ id: 'base', ownerId: 'socket-1' }],
        scores: {
          'socket-1': { name: 'me', squares: 1, color: '#fff' },
          p2: { name: 'P2', squares: 1, color: '#0f0' },
        },
      })
    );

    const ownership = latestMap().ownership;
    expect(ownership).toHaveLength(2);
    expect(ownership.find((c) => c.id === 'base').ownerId).toBe('socket-1');
    expect(ownership.find((c) => c.id === 'c2').ownerId).toBe('p2');
    // scores payload feeds the HUD leaderboard.
    expect(screen.getByText('P2')).toBeInTheDocument();
  });

  it('location-update throttles ≥250 ms, default heading 0', () => {
    let t = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    const pos = (lat) => ({ lat, lng: 0.1 });
    const props = baseProps({ position: pos(0.1) });
    const { rerender } = render(<GameScreen {...props} />);
    expect(socket._emits('location-update')).toHaveLength(1);
    expect(socket._emits('location-update')[0][1].heading).toBe(0);

    t += 100;
    rerender(<GameScreen {...props} position={pos(0.10001)} />);
    expect(socket._emits('location-update')).toHaveLength(1);

    t += 300;
    rerender(<GameScreen {...props} position={pos(0.10002)} />);
    expect(socket._emits('location-update')).toHaveLength(2);
  });

  it('time-sync ack computes skew passed to ProjectileLayer', () => {
    render(<GameScreen {...baseProps()} />);
    const call = socket._emits('time-sync')[0];
    const send = call[1];
    const ack = call[2];
    act(() => ack({ serverNowMs: send + 5000 }));
    // skew = serverNow - (send + rtt/2); rtt ≈ 0 under the same tick.
    expect(latestProj().skewMs).toBeGreaterThan(4900);
    expect(latestProj().skewMs).toBeLessThanOrEqual(5000);
  });

  it('match-end fetches the global leaderboard and renders rows', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        top: [{ playerId: 'x', name: 'Champion', squaresCaptured: 9 }],
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    render(<GameScreen {...baseProps()} />);
    act(() =>
      socket._trigger('match-end', {
        leaderboard: [
          { id: 'socket-1', name: 'me', squares: 5, color: '#fff' },
        ],
      })
    );
    expect(fetchSpy).toHaveBeenCalledWith('/api/leaderboard?limit=10');
    expect(await screen.findByText('Champion')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('match-end with a non-ok response shows the empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }))
    );
    render(<GameScreen {...baseProps()} />);
    act(() => socket._trigger('match-end', { leaderboard: [] }));
    expect(
      await screen.findByText('No scores archived yet.')
    ).toBeInTheDocument();
  });

  it('unmount clears bot interval + disconnects its socket', async () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(
      <GameScreen
        {...baseProps({ simulate: true, initialSnapshot: snapshot })}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /\+ Bot/ }));
      await vi.dynamicImportSettled();
    });

    expect(botSockets.list).toHaveLength(1);
    // The bot moves on a 500 ms interval; ControlPanel's shield
    // countdown (100 ms) is the other interval in this tree.
    const botCallIdx = setSpy.mock.calls.findIndex((c) => c[1] === 500);
    expect(botCallIdx).toBeGreaterThanOrEqual(0);
    const intervalId = setSpy.mock.results[botCallIdx].value;

    unmount();
    expect(clearSpy).toHaveBeenCalledWith(intervalId);
    expect(botSockets.list[0].disconnect).toHaveBeenCalled();
  });

  it('names bots sequentially starting at Bot-1', async () => {
    render(
      <GameScreen
        {...baseProps({ simulate: true, initialSnapshot: snapshot })}
      />
    );
    const spawn = async () => {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /\+ Bot/ }));
        await vi.dynamicImportSettled();
      });
    };
    const onConnect = (i) =>
      botSockets.list[i].on.mock.calls.find((c) => c[0] === 'connect')[1];

    await spawn();
    onConnect(0)();
    expect(botSockets.list[0].emit).toHaveBeenCalledWith(
      'room-join',
      expect.objectContaining({ name: 'Bot-1' })
    );

    await spawn();
    onConnect(1)();
    expect(botSockets.list[1].emit).toHaveBeenCalledWith(
      'room-join',
      expect.objectContaining({ name: 'Bot-2' })
    );
  });

  it('unmount during spawn import disconnects the bot', async () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(
      <GameScreen
        {...baseProps({ simulate: true, initialSnapshot: snapshot })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /\+ Bot/ }));
    // Unmount while `await import("socket.io-client")` is pending.
    unmount();
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(botSockets.list).toHaveLength(1);
    expect(botSockets.list[0].disconnect).toHaveBeenCalled();
    const botCallIdx = setSpy.mock.calls.findIndex((c) => c[1] === 500);
    expect(botCallIdx).toBeGreaterThanOrEqual(0);
    expect(clearSpy).toHaveBeenCalledWith(
      setSpy.mock.results[botCallIdx].value
    );
  });
});
