// Tests for RoomRegistry.softDisconnect — the mobile-reconnect grace period
// lifecycle: mark disconnected, broadcast, schedule a hard leave, and the
// destroy-path cleanup of pending timers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry } from '../src/roomRegistry.js';

function makeIoStub() {
  const events = [];
  const rooms = new Map();
  function room(id) {
    if (!rooms.has(id)) rooms.set(id, new Set());
    return rooms.get(id);
  }
  return {
    _events: events,
    _rooms: rooms,
    to: (id) => ({
      emit(event, payload) { events.push({ scope: id, event, payload }); },
    }),
    in: (id) => ({
      async fetchSockets() { return [...room(id)]; },
    }),
    emit(event, payload) { events.push({ scope: '*', event, payload }); },
  };
}

function fakeSocket(id, io) {
  const sock = {
    id,
    data: {},
    _emitted: [],
    on() {},
    emit(ev, payload) { this._emitted.push({ event: ev, payload }); },
    join(roomId) {
      if (io) {
        if (!io._rooms.has(roomId)) io._rooms.set(roomId, new Set());
        io._rooms.get(roomId).add(sock);
      }
    },
    leave(roomId) { io?._rooms.get(roomId)?.delete(sock); },
  };
  return sock;
}

const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

test('softDisconnect marks connected=false and broadcasts player-disconnected', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'SD1', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const s1 = fakeSocket('s1', io);
  await reg.join(meta.id, s1, 'A');
  io._events.length = 0;

  await reg.softDisconnect(meta.id, s1);

  const game = reg.get(meta.id);
  const p = await game.playerStore.get('s1');
  assert.equal(p.connected, false, 'player marked disconnected');

  const evt = io._events.find((e) => e.event === 'player-disconnected');
  assert.ok(evt, 'player-disconnected broadcast');
  assert.equal(evt.scope, meta.id);
  assert.deepEqual(evt.payload, { id: 's1' });

  assert.equal(s1.data.roomId, null, 'socket detached from room');
  assert.ok(reg._disconnectTimers.has('s1'), 'grace timer scheduled');
  const freshMeta = await reg._metaStore.get(meta.id);
  assert.equal(freshMeta.playerCount, 1, 'player still counted during grace');
});

test('disconnect grace expiry removes player and destroys empty room', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'SD2', maxPlayers: 4 });
  const game = reg.get(meta.id);
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const s1 = fakeSocket('s1', io);
  await reg.join(meta.id, s1, 'A');
  // Force the flat 30s grace (join auto-started the clash match, which
  // would otherwise stretch the grace to remainingSeconds + 30s).
  game.matchActive = false;

  await reg.softDisconnect(meta.id, s1);
  io._events.length = 0;

  t.mock.timers.tick(31_000);
  await flush();

  assert.equal(await game.playerStore.get('s1'), undefined, 'player removed');
  const left = io._events.find((e) => e.event === 'player-left');
  assert.ok(left, 'player-left broadcast');
  assert.deepEqual(left.payload, { id: 's1' });
  assert.equal(reg.get(meta.id), null, 'empty room destroyed');
  assert.equal((await reg.list()).find((r) => r.id === meta.id), undefined);
});

test('grace period extends to remainingSeconds + 30s while match active', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'SD3', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const s1 = fakeSocket('s1', io);
  await reg.join(meta.id, s1, 'A');
  const game = reg.get(meta.id);
  assert.equal(game.matchActive, true, 'join auto-started the match');
  game.remainingSeconds = 10; // grace = 10s + 30s = 40s

  await reg.softDisconnect(meta.id, s1);

  t.mock.timers.tick(30_001);
  await flush();
  assert.ok(await game.playerStore.get('s1'), 'still present before 40s grace');

  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(await game.playerStore.get('s1'), undefined, 'removed after 40s');
});

test('snake room always uses the flat 30s grace (no remainingSeconds)', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'SD3s', gameType: 'snake' });
  t.after(() => reg.destroy(meta.id));
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const s1 = fakeSocket('s1', io);
  await reg.join(meta.id, s1, 'A');
  const game = reg.get(meta.id);
  assert.equal(game.matchActive, true);

  await reg.softDisconnect(meta.id, s1);

  t.mock.timers.tick(30_001);
  await flush();
  assert.equal(await game.playerStore.get('s1'), undefined,
    'snake player removed after flat 30s despite active match');
});

test('softDisconnect falls back to hard leave when player record missing', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'SD4', maxPlayers: 4 });
  const game = reg.get(meta.id);

  const s1 = fakeSocket('s1', io);
  await reg.join(meta.id, s1, 'A');
  // Simulate the record being purged (e.g. post-match cleanup).
  await game.playerStore.del('s1');
  io._events.length = 0;

  await reg.softDisconnect(meta.id, s1);

  const left = io._events.find((e) => e.event === 'player-left');
  assert.ok(left, 'immediate player-left, not player-disconnected');
  assert.deepEqual(left.payload, { id: 's1' });
  assert.equal(
    io._events.find((e) => e.event === 'player-disconnected'),
    undefined
  );
  assert.equal(reg._disconnectTimers.size, 0, 'no grace timer scheduled');
  assert.equal(reg.get(meta.id), null, 'room destroyed once empty');
});

test('pending disconnect timer after destroy() fires harmlessly', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'SD5', maxPlayers: 4 });
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const s1 = fakeSocket('s1', io);
  await reg.join(meta.id, s1, 'A');
  const game = reg.get(meta.id);
  game.matchActive = false; // flat 30s grace
  await reg.softDisconnect(meta.id, s1);
  assert.ok(reg._disconnectTimers.has('s1'));

  await reg.destroy(meta.id);
  io._events.length = 0;

  t.mock.timers.tick(60_000);
  await flush();

  assert.equal(
    io._events.find((e) => e.event === 'player-left'),
    undefined,
    'leaked timer leave() early-returns on missing game'
  );
  assert.equal(reg._disconnectTimers.size, 0, 'timer map drained by its own callback');
});

test('destroy() evicts room sockets and clears socket.data.roomId', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'SD6', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));

  const s1 = fakeSocket('s1', io);
  const s2 = fakeSocket('s2', io);
  await reg.join(meta.id, s1, 'A');
  await reg.join(meta.id, s2, 'B');
  assert.equal(io._rooms.get(meta.id).size, 2, 'both sockets in room');

  await reg.destroy(meta.id);

  assert.equal(io._rooms.get(meta.id).size, 0, 'sockets evicted');
  assert.equal(s1.data.roomId, null);
  assert.equal(s2.data.roomId, null);
});

test('destroy() resolves even when fetchSockets rejects', async () => {
  const io = makeIoStub();
  io.in = () => ({
    async fetchSockets() { throw new Error('socket.io blew up'); },
  });
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'SD6b', maxPlayers: 4 });
  await assert.doesNotReject(() => reg.destroy(meta.id));
  assert.equal(reg.get(meta.id), null);
});
