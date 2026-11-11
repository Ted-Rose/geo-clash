// Tests for RoomRegistry's session-reconnect flow — the sessionId branch
// of join() that swaps a dead socketId for a live one (clash only).

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

// Fake socket that records emitted events, registered handlers, and tracks
// room membership on the io stub.
function fakeSocket(id, io) {
  const sock = {
    id,
    data: {},
    _handlers: new Map(),
    _emitted: [],
    on(ev, cb) { this._handlers.set(ev, cb); },
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

const flush = () => new Promise((r) => setImmediate(r));

test('join with matching sessionId reconnects and swaps socketId', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'RC', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));

  const s1 = fakeSocket('s1', io);
  const first = await reg.join(meta.id, s1, 'Alice', 'sess-1');
  assert.equal(first.ok, true);

  const s2 = fakeSocket('s2', io);
  const result = await reg.join(meta.id, s2, 'Alice', 'sess-1');

  assert.equal(result.ok, true);
  assert.equal(result.reconnected, true);

  const game = reg.get(meta.id);
  const p = await game.playerStore.get('s2');
  assert.ok(p, 'player record keyed by new socket id');
  assert.equal(p.id, 's2');
  assert.equal(await game.playerStore.get('s1'), undefined, 'old key gone');

  const evt = io._events.find((e) => e.event === 'player-reconnected');
  assert.ok(evt, 'player-reconnected broadcast');
  assert.equal(evt.scope, meta.id);
  assert.deepEqual(evt.payload, { id: 's2', oldId: 's1' });

  const emitted = s2._emitted.map((e) => e.event);
  assert.ok(emitted.includes('joined'), 'joined emitted to s2');
  assert.ok(emitted.includes('snapshot'), 'snapshot emitted to s2');

  const freshMeta = await reg._metaStore.get(meta.id);
  assert.equal(freshMeta.playerCount, 1, 'playerCount unchanged by reconnect');
  assert.equal(s2.data.gameType, 'clash');
  assert.equal(s2.data.roomId, meta.id);

  for (const ev of ['location-update', 'player-attack', 'player-shield', 'player-respawn']) {
    assert.ok(s2._handlers.has(ev), `clash handler ${ev} re-registered on s2`);
  }
});

test('reconnect cancels pending disconnect timer', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'RC2', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const s1 = fakeSocket('s1', io);
  await reg.join(meta.id, s1, 'Alice', 'sess-1');
  await reg.softDisconnect(meta.id, s1);
  assert.ok(reg._disconnectTimers.has('s1'), 'disconnect timer pending');

  const s2 = fakeSocket('s2', io);
  const result = await reg.join(meta.id, s2, 'Alice', 'sess-1');
  assert.equal(result.reconnected, true);
  assert.equal(reg._disconnectTimers.size, 0, 'pending timer cancelled');

  const game = reg.get(meta.id);
  const p = await game.playerStore.get('s2');
  assert.equal(p.connected, true, 'player marked connected again');

  // Advance well past the grace period: the cleared timer must not fire.
  io._events.length = 0;
  t.mock.timers.tick(10 * 60_000);
  await flush();
  assert.ok(await game.playerStore.get('s2'), 'player not removed by zombie timer');
  assert.equal(
    io._events.find((e) => e.event === 'player-left'),
    undefined,
    'no player-left after cancelled timer'
  );
});

test('reconnect while player still connected takes over the session', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'RC3', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));

  const s1 = fakeSocket('s1', io);
  await reg.join(meta.id, s1, 'Alice', 'sess-1');
  // No softDisconnect — s1 is still "connected".

  const s2 = fakeSocket('s2', io);
  const result = await reg.join(meta.id, s2, 'Alice', 'sess-1');
  assert.equal(result.ok, true);
  assert.equal(result.reconnected, true, 'session takeover without disconnect');

  const game = reg.get(meta.id);
  assert.equal(await game.playerStore.get('s1'), undefined);
  assert.ok(await game.playerStore.get('s2'));
});

test('snake room ignores sessionId — no reconnect support', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'SnakeRC', gameType: 'snake' });
  t.after(() => reg.destroy(meta.id));

  const s1 = fakeSocket('s1', io);
  await reg.join(meta.id, s1, 'Snek', 'sess-1');
  await reg.softDisconnect(meta.id, s1);

  const s2 = fakeSocket('s2', io);
  const result = await reg.join(meta.id, s2, 'Snek', 'sess-1');
  assert.equal(result.ok, true);
  assert.notEqual(result.reconnected, true,
    'SnakeGameState lacks getPlayerBySessionId — falls through to addPlayer');
  const freshMeta = await reg._metaStore.get(meta.id);
  assert.equal(freshMeta.playerCount, 2, 'second player added instead of swap');
});

test('snake room at capacity returns room-full even with a sessionId', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'SnakeFull', gameType: 'snake', maxPlayers: 1 });
  t.after(() => reg.destroy(meta.id));

  const s1 = fakeSocket('s1', io);
  await reg.join(meta.id, s1, 'Snek', 'sess-1');
  await reg.softDisconnect(meta.id, s1);

  const s2 = fakeSocket('s2', io);
  const result = await reg.join(meta.id, s2, 'Snek', 'sess-1');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'room-full');
});

test('join rejects no-such-room and ended rooms', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'Gone', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));

  const s1 = fakeSocket('s1', io);
  const missing = await reg.join('nope', s1, 'A');
  assert.deepEqual(missing, { ok: false, reason: 'no-such-room' });

  // Seed the meta as ended while the game still lives in _rooms.
  const stored = await reg._metaStore.get(meta.id);
  stored.status = 'ended';
  await reg._metaStore.set(meta.id, stored);

  const ended = await reg.join(meta.id, s1, 'A');
  assert.deepEqual(ended, { ok: false, reason: 'ended' });
});
