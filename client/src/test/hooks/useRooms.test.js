import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { makeFakeSocket, socketState } from '../fakeSocket.js';
import { useRooms } from '../../hooks/useRooms.js';

vi.mock('../../socket.js', () => ({
  getSocket: () => socketState.current,
  getSessionId: () => 'sess-test',
  API_BASE: '',
  SERVER_URL: '/',
}));

let socket;
beforeEach(() => {
  socket = makeFakeSocket({ connected: true });
  socketState.current = socket;
});

function lastAck(event = 'rooms-list') {
  const calls = socket._emits(event);
  return calls[calls.length - 1]?.[1];
}

describe('useRooms', () => {
  it('seeds from rooms-list ack and updates on rooms-updated', () => {
    const { result } = renderHook(() => useRooms());
    expect(socket._emits('rooms-list')).toHaveLength(1);
    expect(result.current.loading).toBe(true);

    act(() => lastAck()({ rooms: [{ id: 'r1' }] }));
    expect(result.current.rooms).toEqual([{ id: 'r1' }]);
    expect(result.current.loading).toBe(false);

    act(() => socket._trigger('rooms-updated', { rooms: [{ id: 'r2' }] }));
    expect(result.current.rooms).toEqual([{ id: 'r2' }]);
  });

  it('ignores non-array rooms in push and ack, but still clears loading', () => {
    const { result } = renderHook(() => useRooms());
    act(() => lastAck()({ rooms: [{ id: 'r1' }] }));

    act(() => socket._trigger('rooms-updated', { rooms: 'nope' }));
    expect(result.current.rooms).toEqual([{ id: 'r1' }]);

    act(() => result.current.refresh());
    act(() => lastAck()({}));
    expect(result.current.loading).toBe(false);
    expect(result.current.rooms).toEqual([{ id: 'r1' }]);
  });

  it('refreshes on connect event and unsubscribes on unmount', () => {
    socket.connected = false;
    const { unmount } = renderHook(() => useRooms());
    expect(socket._emits('rooms-list')).toHaveLength(0);

    act(() => socket._trigger('connect'));
    expect(socket._emits('rooms-list')).toHaveLength(1);

    unmount();
    const offEvents = socket.off.mock.calls.map((c) => c[0]);
    expect(offEvents).toContain('rooms-updated');
    expect(offEvents).toContain('connect');
  });
});
