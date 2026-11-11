import { vi } from 'vitest';

// Hand-rolled Socket.io stand-in, mirroring the server suite's io-stub
// convention. `on` records handlers per event, `_trigger(event, payload)`
// fires them, and `emit` records calls (an ack callback passed as the last
// argument can be invoked by the test).
export function makeFakeSocket({ id = 'socket-1', connected = false } = {}) {
  const handlers = new Map();
  const socket = {
    id,
    connected,
    on: vi.fn((event, fn) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(fn);
      return socket;
    }),
    off: vi.fn((event, fn) => {
      const list = handlers.get(event);
      if (!list) return socket;
      const idx = fn ? list.indexOf(fn) : 0;
      if (idx >= 0) list.splice(idx, 1);
      return socket;
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    _trigger(event, payload) {
      for (const fn of handlers.get(event) || []) fn(payload);
    },
    _has(event) {
      return (handlers.get(event) || []).length > 0;
    },
    // Emit calls whose last arg was a function, for ack assertions.
    _emits(name) {
      return socket.emit.mock.calls.filter((c) => c[0] === name);
    },
    _ackFor(name, index = 0) {
      const calls = socket._emits(name);
      const call = calls[index];
      if (!call) return null;
      const last = call[call.length - 1];
      return typeof last === 'function' ? last : null;
    },
  };
  return socket;
}

// Shared mutable slot so `vi.mock('../shared/socket.js')` factories (which run before
// test bodies) can hand the current fake to getSocket().
export const socketState = { current: null };
