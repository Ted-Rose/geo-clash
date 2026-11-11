// Unit tests for shared/timeSync.js — ack reply vs emit fallback.

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTimeSync } from '../src/shared/timeSync.js';

function fakeSocket(id) {
  return {
    id,
    data: {},
    _handlers: new Map(),
    _emitted: [],
    on(ev, cb) { this._handlers.set(ev, cb); },
    emit(ev, payload) { this._emitted.push({ event: ev, payload }); },
  };
}

test('time-sync with ack replies clientSendMs + serverNowMs', () => {
  const sock = fakeSocket('t1');
  registerTimeSync(sock);

  const calls = [];
  const before = Date.now();
  sock._handlers.get('time-sync')(1234, (payload) => calls.push(payload));
  const after = Date.now();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].clientSendMs, 1234, 'echoes client send timestamp');
  assert.ok(
    calls[0].serverNowMs >= before && calls[0].serverNowMs <= after,
    'serverNowMs ≈ Date.now()'
  );
  assert.equal(sock._emitted.length, 0, 'ack path does not emit');
});

test('time-sync without ack falls back to socket.emit', () => {
  const sock = fakeSocket('t2');
  registerTimeSync(sock);

  sock._handlers.get('time-sync')(5678);

  const evt = sock._emitted.find((e) => e.event === 'time-sync');
  assert.ok(evt, 'time-sync emitted back to socket');
  assert.equal(evt.payload.clientSendMs, 5678);
  assert.equal(typeof evt.payload.serverNowMs, 'number');
});
