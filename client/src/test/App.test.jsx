import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { makeFakeSocket, socketState } from './fakeSocket.js';
import App from '../App.jsx';

const lobbyProps = vi.hoisted(() => ({ calls: [] }));
const clashProps = vi.hoisted(() => ({ calls: [] }));

vi.mock('../socket.js', () => ({
  getSocket: () => socketState.current,
  getSessionId: () => 'sess-xyz',
  API_BASE: '',
  SERVER_URL: '/',
}));

vi.mock('../hooks/useGeolocation.js', () => ({
  useGeolocation: () => ({
    position: { lat: 1, lng: 2, heading: 0 },
    error: null,
  }),
}));

vi.mock('../components/LobbyScreen.jsx', async () => {
  const React = await import('react');
  return {
    default: (props) => {
      lobbyProps.calls.push(props);
      return React.createElement('div', null, 'LOBBY');
    },
  };
});

vi.mock('../components/GameScreen.jsx', async () => {
  const React = await import('react');
  return {
    default: (props) => {
      clashProps.calls.push(props);
      return React.createElement('div', null, 'CLASH');
    },
  };
});

vi.mock('../snake/GameScreen.jsx', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', null, 'SNAKE'),
  };
});

let socket;
const latestLobby = () => lobbyProps.calls.at(-1);
const latestClash = () => clashProps.calls.at(-1);

beforeEach(() => {
  socket = makeFakeSocket({ id: 'socket-1', connected: false });
  socketState.current = socket;
  lobbyProps.calls = [];
  clashProps.calls = [];
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App persisted preferences', () => {
  it('defaults maxImageryAge/maxNativeZoom to 3/18 and persists changes', () => {
    render(<App />);
    expect(latestLobby().maxImageryAge).toBe(3);
    expect(latestLobby().maxNativeZoom).toBe(18);

    act(() => latestLobby().setMaxImageryAge(7));
    expect(localStorage.getItem('maxImageryAge')).toBe('7');
    expect(latestLobby().maxImageryAge).toBe(7);

    act(() => latestLobby().setMaxNativeZoom(16));
    expect(localStorage.getItem('maxNativeZoom')).toBe('16');
    expect(latestLobby().maxNativeZoom).toBe(16);
  });

  it('parses pre-seeded localStorage values', () => {
    localStorage.setItem('maxImageryAge', '7');
    localStorage.setItem('maxNativeZoom', '16');
    render(<App />);
    expect(latestLobby().maxImageryAge).toBe(7);
    expect(latestLobby().maxNativeZoom).toBe(16);
  });
});

describe('App reconnect flow', () => {
  function joinGame() {
    act(() =>
      latestLobby().onJoined({
        roomId: 'r1',
        room: { gameType: 'clash' },
        snapshot: { s: 1 },
        name: 'Neo',
      })
    );
    expect(screen.getByText('CLASH')).toBeInTheDocument();
  }

  it('re-emits room-join on connect; failed ack returns to lobby', () => {
    render(<App />);
    joinGame();
    act(() => socket._trigger('connect'));
    const call = socket._emits('room-join')[0];
    expect(call[1]).toEqual({
      roomId: 'r1',
      name: 'Neo',
      sessionId: 'sess-xyz',
    });
    act(() => call[2]({ ok: false }));
    expect(screen.getByText('LOBBY')).toBeInTheDocument();
  });

  it('pushes the ack snapshot as reconnectSnap on success', () => {
    render(<App />);
    joinGame();
    act(() => socket._trigger('connect'));
    const call = socket._emits('room-join')[0];
    act(() => call[2]({ ok: true, snapshot: { s: 9 } }));
    expect(screen.getByText('CLASH')).toBeInTheDocument();
    expect(latestClash().reconnectSnap).toEqual({
      id: 'socket-1',
      snapshot: { s: 9 },
    });
  });
});
