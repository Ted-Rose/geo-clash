import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeFakeSocket, socketState } from '../fakeSocket.js';
import LobbyScreen from '../../shared/LobbyScreen.jsx';

const roomsMock = vi.hoisted(() => ({
  current: { rooms: [], loading: false, refresh: vi.fn() },
}));

vi.mock('../../shared/socket.js', () => ({
  getSocket: () => socketState.current,
  getSessionId: () => 'sess-abc',
  API_BASE: '',
  SERVER_URL: '/',
}));

vi.mock('../../shared/hooks/useRooms.js', () => ({
  useRooms: () => roomsMock.current,
}));

let socket;

function baseProps(overrides = {}) {
  return {
    onJoined: vi.fn(),
    connected: true,
    simulate: false,
    setSimulate: vi.fn(),
    simPos: null,
    setSimPos: vi.fn(),
    maxImageryAge: 3,
    setMaxImageryAge: vi.fn(),
    maxNativeZoom: 18,
    setMaxNativeZoom: vi.fn(),
    position: { lat: 52.5, lng: 13.4, heading: 0 },
    connectError: null,
    ...overrides,
  };
}

const room = (over = {}) => ({
  id: 'r1',
  name: 'Alpha',
  playerCount: 1,
  maxPlayers: 8,
  status: 'open',
  createdAt: 1,
  gameType: 'clash',
  ...over,
});

const createPayload = () => socket._emits('room-create')[0][1];
const joinPayload = () => socket._emits('room-join').at(-1)[1];
const joinAck = () => socket._ackFor('room-join');

beforeEach(() => {
  socket = makeFakeSocket({ connected: true });
  socketState.current = socket;
  roomsMock.current = { rooms: [], loading: false, refresh: vi.fn() };
  localStorage.clear();
  vi.clearAllMocks();
});

describe('room-create payloads', () => {
  it('emits clash payload with ammo fields only when ammoLimit > 0', async () => {
    const user = userEvent.setup();
    render(<LobbyScreen {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: '3 rockets' }));
    await user.click(screen.getByRole('button', { name: /create \+ join/i }));
    const payload = createPayload();
    expect(payload).toMatchObject({
      gameType: 'clash',
      maxAmmo: 3,
      ammoRenewalMs: 5000,
      centerLat: 52.5,
      centerLng: 13.4,
    });
    expect(payload).not.toHaveProperty('foodCountTarget');
  });

  it('omits ammo fields for unlimited ammo', async () => {
    const user = userEvent.setup();
    render(<LobbyScreen {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /create \+ join/i }));
    const payload = createPayload();
    expect(payload).not.toHaveProperty('maxAmmo');
    expect(payload).not.toHaveProperty('ammoRenewalMs');
  });

  it('emits snake-only keys when snake is selected', async () => {
    const user = userEvent.setup();
    render(<LobbyScreen {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: 'Geo Snake' }));
    await user.click(screen.getByRole('button', { name: /create \+ join/i }));
    const payload = createPayload();
    expect(payload).toMatchObject({
      gameType: 'snake',
      foodCountTarget: 30,
      foodRespawnIntervalMs: 1000,
      arenaSideMeters: 50,
      timeLimitMs: 0,
    });
    // cellSize/squaresPerSide are sent unconditionally (server ignores
    // them for snake rooms); only the ammo fields are clash-gated.
    expect(payload).not.toHaveProperty('maxAmmo');
    expect(payload).not.toHaveProperty('ammoRenewalMs');
  });
});

describe('joinRoom', () => {
  it('is disabled until position+connected are ready', async () => {
    roomsMock.current.rooms = [room()];
    const user = userEvent.setup();
    render(<LobbyScreen {...baseProps({ position: null })} />);
    const btn = screen.getByText('Alpha').closest('button');
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(socket._emits('room-join')).toHaveLength(0);
  });

  it('sets error and refreshes on no-such-room ack', async () => {
    roomsMock.current.rooms = [room()];
    const user = userEvent.setup();
    render(<LobbyScreen {...baseProps()} />);
    await user.click(screen.getByText('Alpha').closest('button'));
    expect(joinPayload()).toMatchObject({
      roomId: 'r1',
      lat: 52.5,
      lng: 13.4,
      sessionId: 'sess-abc',
    });
    act(() => joinAck()({ ok: false, reason: 'no-such-room' }));
    expect(screen.getByText('no-such-room')).toBeInTheDocument();
    expect(roomsMock.current.refresh).toHaveBeenCalled();
  });

  it('shows error but does not refresh for other reasons', async () => {
    roomsMock.current.rooms = [room()];
    const user = userEvent.setup();
    render(<LobbyScreen {...baseProps()} />);
    await user.click(screen.getByText('Alpha').closest('button'));
    act(() => joinAck()({ ok: false, reason: 'full' }));
    expect(screen.getByText('full')).toBeInTheDocument();
    expect(roomsMock.current.refresh).not.toHaveBeenCalled();
  });

  it('calls onJoined with trimmed name on ok ack', async () => {
    roomsMock.current.rooms = [room()];
    const onJoined = vi.fn();
    const user = userEvent.setup();
    render(<LobbyScreen {...baseProps({ onJoined })} />);
    await user.type(screen.getByPlaceholderText('Anonymous'), '  Ted  ');
    await user.click(screen.getByText('Alpha').closest('button'));
    const snapshot = { players: [] };
    act(() => joinAck()({ ok: true, room: room(), snapshot }));
    expect(onJoined).toHaveBeenCalledWith({
      roomId: 'r1',
      room: expect.objectContaining({ id: 'r1' }),
      snapshot,
      name: 'Ted',
    });
  });

  it('passes name as undefined when left blank', async () => {
    roomsMock.current.rooms = [room()];
    const onJoined = vi.fn();
    const user = userEvent.setup();
    render(<LobbyScreen {...baseProps({ onJoined })} />);
    await user.click(screen.getByText('Alpha').closest('button'));
    expect(joinPayload().name).toBeUndefined();
    act(() => joinAck()({ ok: true, room: room(), snapshot: {} }));
    expect(onJoined.mock.calls[0][0].name).toBeUndefined();
  });
});

describe('create → join auto-flow', () => {
  it('emits room-join with ack.room.id after create ok', async () => {
    const onJoined = vi.fn();
    const user = userEvent.setup();
    render(<LobbyScreen {...baseProps({ onJoined })} />);
    await user.click(screen.getByRole('button', { name: /create \+ join/i }));
    const createAck = socket._ackFor('room-create');
    act(() => createAck({ ok: true, room: { id: 'r9' } }));
    expect(joinPayload()).toMatchObject({
      roomId: 'r9',
      lat: 52.5,
      lng: 13.4,
      sessionId: 'sess-abc',
    });
    act(() => joinAck()({ ok: true, snapshot: { s: 2 } }));
    expect(onJoined).toHaveBeenCalledWith({
      roomId: 'r9',
      room: { id: 'r9' },
      snapshot: { s: 2 },
      name: undefined,
    });
  });

  it('shows error and skips onJoined when the auto-join ack fails', async () => {
    const onJoined = vi.fn();
    const user = userEvent.setup();
    render(<LobbyScreen {...baseProps({ onJoined })} />);
    await user.click(screen.getByRole('button', { name: /create \+ join/i }));
    act(() => socket._ackFor('room-create')({ ok: true, room: { id: 'r9' } }));
    act(() => joinAck()({ ok: false, reason: 'ended' }));
    expect(screen.getByText('ended')).toBeInTheDocument();
    expect(onJoined).not.toHaveBeenCalled();
  });

  it('does not emit room-join when create ack fails', async () => {
    const user = userEvent.setup();
    render(<LobbyScreen {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /create \+ join/i }));
    act(() => socket._ackFor('room-create')({ ok: false, reason: 'nope' }));
    expect(screen.getByText('nope')).toBeInTheDocument();
    expect(socket._emits('room-join')).toHaveLength(0);
  });
});

describe('room list rendering', () => {
  it('lists newest createdAt first and disables full/ended rooms', () => {
    roomsMock.current.rooms = [
      room({ id: 'a', name: 'Old', createdAt: 1 }),
      room({ id: 'b', name: 'New', createdAt: 3 }),
      room({ id: 'c', name: 'Mid', createdAt: 2 }),
      room({ id: 'd', name: 'Full', createdAt: 4, playerCount: 8 }),
      room({ id: 'e', name: 'Over', createdAt: 5, status: 'ended' }),
    ];
    const { container } = render(<LobbyScreen {...baseProps()} />);
    const names = [...container.querySelectorAll('ul li button')].map(
      (b) => b.querySelector('.font-semibold').textContent
    );
    expect(names).toEqual(['Over', 'Full', 'New', 'Mid', 'Old']);
    const byName = (n) =>
      screen.getByText(n).closest('button');
    expect(byName('Full')).toBeDisabled();
    expect(byName('Over')).toBeDisabled();
    expect(byName('New')).toBeEnabled();
  });
});

describe('simulate seeding', () => {
  it('seeds the default simPos once when simulate is toggled on', () => {
    const setSimPos = vi.fn();
    render(
      <LobbyScreen {...baseProps({ simulate: true, simPos: null, setSimPos })} />
    );
    expect(setSimPos).toHaveBeenCalledTimes(1);
    expect(setSimPos).toHaveBeenCalledWith({
      lat: 52.5163,
      lng: 13.3777,
      heading: 0,
    });
  });

  it('does not overwrite an existing simPos', () => {
    const setSimPos = vi.fn();
    const simPos = { lat: 1, lng: 2, heading: 0 };
    render(
      <LobbyScreen {...baseProps({ simulate: true, simPos, setSimPos })} />
    );
    expect(setSimPos).not.toHaveBeenCalled();
  });
});
