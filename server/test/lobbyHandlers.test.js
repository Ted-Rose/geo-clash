// Socket-level tests for the top-level dispatcher in socketHandlers.js —
// the lobby contract (rooms-updated/rooms-list/room-create/room-join/
// room-leave/disconnect) plus gameType handler dispatch.

import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry } from '../src/roomRegistry.js';
import { registerSocketHandlers } from '../src/socketHandlers.js';

// io stub that also captures the `connection` callback.
function makeIoStub() {
  const events = [];
  const rooms = new Map();
  const handlers = new Map();
  function room(id) {
    if (!rooms.has(id)) rooms.set(id, new Set());
    return rooms.get(id);
  }
  return {
    _events: events,
    _rooms: rooms,
    _handlers: handlers,
    _conn: null,
    on(ev, cb) {
      handlers.set(ev, cb);
      if (ev === 'connection') this._conn = cb;
    },
    to: (id) => ({
      emit(event, payload) { events.push({ scope: id, event, payload }); },
    }),
    in: (id) => ({
      async fetchSockets() { return [...room(id)]; },
    }),
    emit(event, payload) { events.push({ scope: '*', event, payload }); },
  };
}

// Fake socket with handler registration + a trigger() that invokes and
// awaits the registered handler, like socket.io would.
function fakeSocket(id, io) {
  const sock = {
    id,
    data: {},
    _handlers: new Map(),
    _emitted: [],
    on(ev, cb) { this._handlers.set(ev, cb); },
    emit(ev, payload) { this._emitted.push({ event: ev, payload }); },
    join(roomId) {
      if (!io._rooms.has(roomId)) io._rooms.set(roomId, new Set());
      io._rooms.get(roomId).add(sock);
    },
    leave(roomId) { io._rooms.get(roomId)?.delete(sock); },
    async trigger(ev, ...args) {
      const cb = this._handlers.get(ev);
      assert.ok(cb, `no handler registered for ${ev}`);
      return await cb(...args);
    },
  };
  return sock;
}

function makeHarness() {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  registerSocketHandlers(io, reg);
  return { io, reg };
}

// ack factory: captures the payload it is called with.
function ackSpy() {
  const calls = [];
  const fn = (...args) => calls.push(args);
  fn.calls = calls;
  return fn;
}

test('connection emits rooms-updated and registers handlers', async () => {
  const { io } = makeHarness();
  const sock = fakeSocket('c1', io);
  await io._conn(sock);

  const first = sock._emitted.find((e) => e.event === 'rooms-updated');
  assert.ok(first, 'initial rooms-updated emitted');
  assert.deepEqual(first.payload, { rooms: [] });

  const lobbyEvents = [
    'time-sync', 'rooms-list', 'room-create', 'room-join', 'room-leave',
    'disconnect',
  ];
  for (const ev of lobbyEvents) {
    assert.ok(sock._handlers.has(ev), `handler registered for ${ev}`);
  }
  assert.equal(sock.data.roomId, null);
});

test('rooms-list ack returns rooms; missing ack tolerated', async (t) => {
  const { io, reg } = makeHarness();
  const meta = await reg.create({ name: 'Listed' });
  t.after(() => reg.destroy(meta.id));

  const sock = fakeSocket('c2', io);
  await io._conn(sock);

  const ack = ackSpy();
  await sock.trigger('rooms-list', ack);
  assert.equal(ack.calls.length, 1);
  const ids = ack.calls[0][0].rooms.map((r) => r.id);
  assert.ok(ids.includes(meta.id), 'created room present in rooms-list ack');

  await assert.doesNotReject(() => sock.trigger('rooms-list'));
});

test('room-create acks ok; bad gameType acks fail', async (t) => {
  const { io, reg } = makeHarness();
  const sock = fakeSocket('c3', io);
  await io._conn(sock);
  const created = [];
  t.after(async () => { for (const id of created) await reg.destroy(id); });

  const ack1 = ackSpy();
  await sock.trigger('room-create', { name: 'x' }, ack1);
  const res1 = ack1.calls[0][0];
  assert.equal(res1.ok, true);
  created.push(res1.room.id);
  assert.equal(res1.room.gameType, 'clash', 'default gameType');
  assert.equal(res1.room.hostId, 'c3', 'hostId is the creating socket');
  assert.ok(
    !('maxAmmo' in res1.room),
    'maxAmmo default null → absent from meta'
  );

  const ack2 = ackSpy();
  await sock.trigger('room-create', { name: 's', gameType: 'snake' }, ack2);
  const res2 = ack2.calls[0][0];
  assert.equal(res2.ok, true);
  created.push(res2.room.id);
  assert.equal(res2.room.gameType, 'snake');
  assert.equal(res2.room.foodCountTarget, 5);

  const ack3 = ackSpy();
  await sock.trigger('room-create', { name: 'b', gameType: 'bogus' }, ack3);
  assert.deepEqual(
    ack3.calls[0][0],
    { ok: false, reason: 'unsupported-game-type:bogus' }
  );

  await assert.doesNotReject(
    () => sock.trigger('room-create', { name: 'noack' })
  );
});

test('room-create is capped per socket connection', async (t) => {
  const { io, reg } = makeHarness();
  const sock = fakeSocket('cap1', io);
  await io._conn(sock);
  const created = [];
  t.after(async () => { for (const id of created) await reg.destroy(id); });

  // MAX_ROOMS_PER_SOCKET is 5 — the first five succeed.
  for (let i = 0; i < 5; i++) {
    const ack = ackSpy();
    await sock.trigger('room-create', { name: `r${i}` }, ack);
    assert.equal(ack.calls[0][0].ok, true, `create ${i + 1} ok`);
    created.push(ack.calls[0][0].room.id);
  }

  const ack6 = ackSpy();
  await sock.trigger('room-create', { name: 'r6' }, ack6);
  assert.deepEqual(
    ack6.calls[0][0],
    { ok: false, reason: 'room-create-limit' },
    'sixth room-create on one socket is rejected'
  );

  // A fresh connection gets a fresh counter.
  const sock2 = fakeSocket('cap2', io);
  await io._conn(sock2);
  const ack7 = ackSpy();
  await sock2.trigger('room-create', { name: 'r7' }, ack7);
  assert.equal(ack7.calls[0][0].ok, true, 'new socket creates again');
  created.push(ack7.calls[0][0].room.id);
});

test('room-join without roomId acks no-room-id', async () => {
  const { io } = makeHarness();
  const sock = fakeSocket('c4', io);
  await io._conn(sock);

  const ack1 = ackSpy();
  await sock.trigger('room-join', {}, ack1);
  assert.deepEqual(ack1.calls[0][0], { ok: false, reason: 'no-room-id' });

  const ack2 = ackSpy();
  await sock.trigger('room-join', null, ack2);
  assert.deepEqual(ack2.calls[0][0], { ok: false, reason: 'no-room-id' });
});

test('room-join happy path: joined+snapshot, clash handlers', async (t) => {
  const { io, reg } = makeHarness();
  const meta = await reg.create({ name: 'Arena', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));

  const sock = fakeSocket('c5', io);
  await io._conn(sock);
  const ack = ackSpy();
  await sock.trigger(
    'room-join',
    { roomId: meta.id, name: 'A', lat: 51.5, lng: -0.12 },
    ack
  );

  const res = ack.calls[0][0];
  assert.equal(res.ok, true);

  const events = sock._emitted.map((e) => e.event);
  const joinedIdx = events.indexOf('joined');
  const snapIdx = events.indexOf('snapshot');
  assert.ok(joinedIdx !== -1 && snapIdx > joinedIdx, 'joined then snapshot');
  assert.deepEqual(
    sock._emitted[joinedIdx].payload,
    { id: 'c5', roomId: meta.id }
  );

  const pj = io._events.find(
    (e) => e.scope === meta.id && e.event === 'player-joined'
  );
  assert.ok(pj, 'player-joined broadcast to room');
  assert.deepEqual(pj.payload, { id: 'c5' });

  assert.equal(sock.data.roomId, meta.id);
  assert.equal(sock.data.gameType, 'clash');
  const clashEvents = [
    'location-update', 'player-attack', 'player-shield', 'player-respawn',
  ];
  for (const ev of clashEvents) {
    assert.ok(sock._handlers.has(ev), `clash handler ${ev} registered`);
  }

  const game = reg.get(meta.id);
  assert.ok(game.grid, 'ensureGridFromPlayer ran from join lat/lng');
  const me = res.snapshot.players.find((p) => p.id === 'c5');
  assert.equal(me.lat, 51.5, 'updateLocation applied before snapshot');
  assert.equal(me.lng, -0.12);
});

test('room-join snake room registers snake handlers', async (t) => {
  const { io, reg } = makeHarness();
  const meta = await reg.create({ name: 'Snk', gameType: 'snake' });
  t.after(() => reg.destroy(meta.id));

  const sock = fakeSocket('c6', io);
  await io._conn(sock);
  const ack = ackSpy();
  await sock.trigger(
    'room-join',
    { roomId: meta.id, name: 'S', lat: 51.5, lng: -0.12 },
    ack
  );

  assert.equal(ack.calls[0][0].ok, true);
  assert.equal(sock.data.gameType, 'snake');
  for (const ev of ['location-update', 'eat_food', 'clash_ack']) {
    assert.ok(sock._handlers.has(ev), `snake handler ${ev} registered`);
  }
  assert.equal(
    sock._handlers.has('player-attack'), false, 'no clash handlers'
  );
});

test('room-join with non-numeric lat/lng still joins', async (t) => {
  const { io, reg } = makeHarness();
  const meta = await reg.create({ name: 'NoLoc', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));

  const sock = fakeSocket('c7', io);
  await io._conn(sock);
  const ack = ackSpy();
  await sock.trigger(
    'room-join', { roomId: meta.id, name: 'A', lat: 'x' }, ack
  );

  const res = ack.calls[0][0];
  assert.equal(res.ok, true);
  assert.ok(res.snapshot, 'snapshot present');
  assert.equal(reg.get(meta.id).grid, null, 'no grid without numeric lat/lng');
});

test('room-join reconnect: reconnected, no re-broadcast', async (t) => {
  const { io, reg } = makeHarness();
  const meta = await reg.create({ name: 'ReJ', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const s1 = fakeSocket('c8a', io);
  await io._conn(s1);
  const ack1 = ackSpy();
  await s1.trigger(
    'room-join',
    { roomId: meta.id, name: 'A', sessionId: 'sess-9' },
    ack1
  );
  assert.equal(ack1.calls[0][0].ok, true);

  // Simulate the socket dropping — softDisconnect via the socket path.
  await s1.trigger('disconnect');
  assert.equal(reg._disconnectTimers.has('c8a'), true, 'grace timer pending');

  const s2 = fakeSocket('c8b', io);
  await io._conn(s2);
  io._events.length = 0;
  const ack2 = ackSpy();
  await s2.trigger(
    'room-join',
    { roomId: meta.id, name: 'A', sessionId: 'sess-9' },
    ack2
  );

  const res = ack2.calls[0][0];
  assert.equal(res.ok, true);
  assert.equal(res.reconnected, true);

  assert.ok(
    io._events.find((e) => e.event === 'player-reconnected'),
    'player-reconnected broadcast'
  );
  assert.equal(
    io._events.find((e) => e.event === 'player-joined'),
    undefined,
    'dispatcher skipped player-joined for a reconnect'
  );
  const joinedEmits = s2._emitted.filter((e) => e.event === 'joined');
  assert.equal(joinedEmits.length, 1, 'only the registry emitted joined');
});

test('room-leave delegates to registry.leave', async (t) => {
  const { io, reg } = makeHarness();
  const meta = await reg.create({ name: 'Lv', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));

  const sock = fakeSocket('c9', io);
  await io._conn(sock);
  const ack = ackSpy();
  await sock.trigger('room-join', { roomId: meta.id, name: 'A' }, ack);
  assert.equal(ack.calls[0][0].ok, true);
  io._events.length = 0;

  await sock.trigger('room-leave');

  const left = io._events.find(
    (e) => e.scope === meta.id && e.event === 'player-left'
  );
  assert.ok(left, 'player-left broadcast');
  assert.equal(sock.data.roomId, null);
  assert.equal(reg.get(meta.id), null, 'room destroyed once empty');
});

test('disconnect softDisconnects; idle disconnect is a no-op', async (t) => {
  const { io, reg } = makeHarness();
  const meta = await reg.create({ name: 'DC', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const sock = fakeSocket('c10', io);
  await io._conn(sock);
  const ack = ackSpy();
  await sock.trigger('room-join', { roomId: meta.id, name: 'A' }, ack);
  assert.equal(ack.calls[0][0].ok, true);
  io._events.length = 0;

  await sock.trigger('disconnect');

  const dc = io._events.find(
    (e) => e.scope === meta.id && e.event === 'player-disconnected'
  );
  assert.ok(dc, 'player-disconnected broadcast via socket path');
  assert.ok(reg._disconnectTimers.has('c10'), 'grace timer pending');
  assert.equal(sock.data.roomId, null);

  const fresh = fakeSocket('c10b', io);
  await io._conn(fresh);
  io._events.length = 0;
  await assert.doesNotReject(() => fresh.trigger('disconnect'));
  assert.equal(io._events.length, 0, 'no emits for a lobby disconnect');
});
