// Tests for the idempotent same-socket rejoin guard: a room-join whose
// sessionId resolves to the joining socket's own id must leave the
// player record intact and must not stack duplicate gameplay listeners.

import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry } from '../src/roomRegistry.js';
import { registerSocketHandlers } from '../src/socketHandlers.js';

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
    _conn: null,
    on(ev, cb) {
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

// Fake socket that keeps every registered listener (real socket.io
// stacks them) so tests can count handlers per event.
function multiSocket(id, io) {
  const sock = {
    id,
    data: {},
    _handlers: new Map(), // ev -> [cb, ...]
    _emitted: [],
    on(ev, cb) {
      if (!this._handlers.has(ev)) this._handlers.set(ev, []);
      this._handlers.get(ev).push(cb);
    },
    emit(ev, payload) { this._emitted.push({ event: ev, payload }); },
    join(roomId) {
      if (!io._rooms.has(roomId)) io._rooms.set(roomId, new Set());
      io._rooms.get(roomId).add(sock);
    },
    leave(roomId) { io._rooms.get(roomId)?.delete(sock); },
    listenerCount(ev) { return (this._handlers.get(ev) || []).length; },
    // Invoke every listener registered for ev, like socket.io would.
    async trigger(ev, ...args) {
      const cbs = this._handlers.get(ev) || [];
      assert.ok(cbs.length > 0, `no handler registered for ${ev}`);
      let last;
      for (const cb of cbs) last = await cb(...args);
      return last;
    },
  };
  return sock;
}

function ackSpy() {
  const calls = [];
  const fn = (...args) => calls.push(args);
  fn.calls = calls;
  return fn;
}

test('same-socket session rejoin keeps the player record', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'Idem', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));

  const s1 = multiSocket('s1', io);
  const first = await reg.join(meta.id, s1, 'Alice', 'sess-1');
  assert.equal(first.ok, true);
  io._events.length = 0;

  const again = await reg.join(meta.id, s1, 'Alice', 'sess-1');
  assert.equal(again.ok, true);
  assert.equal(again.reconnected, true);

  const game = reg.get(meta.id);
  const p = await game.playerStore.get('s1');
  assert.ok(p, 'player record survives same-socket rejoin');
  assert.equal(p.id, 's1');
  assert.equal(p.sessionId, 'sess-1');

  // join payloads re-emitted; no room broadcast, no roster change.
  const emitted = s1._emitted.map((e) => e.event);
  assert.equal(
    emitted.filter((e) => e === 'joined').length, 1, 'joined re-emitted'
  );
  assert.equal(
    emitted.filter((e) => e === 'snapshot').length, 1,
    'snapshot re-emitted'
  );
  assert.equal(
    io._events.find((e) => e.event === 'player-reconnected'),
    undefined,
    'no player-reconnected broadcast for a same-socket rejoin'
  );
  const freshMeta = await reg._metaStore.get(meta.id);
  assert.equal(freshMeta.playerCount, 1, 'roster unchanged');
});

test('two joins on one socket handle gameplay events once per emit',
  async (t) => {
    const io = makeIoStub();
    const reg = new RoomRegistry(io);
    registerSocketHandlers(io, reg);
    const meta = await reg.create({ name: 'Twice', maxPlayers: 4 });
    t.after(() => reg.destroy(meta.id));

    const sock = multiSocket('c1', io);
    await io._conn(sock);

    const ack1 = ackSpy();
    await sock.trigger('room-join',
      { roomId: meta.id, name: 'A', sessionId: 'sess-1' }, ack1);
    assert.equal(ack1.calls[0][0].ok, true);

    const ack2 = ackSpy();
    await sock.trigger('room-join',
      { roomId: meta.id, name: 'A', sessionId: 'sess-1' }, ack2);
    const res2 = ack2.calls[0][0];
    assert.equal(res2.ok, true);
    assert.equal(res2.reconnected, true);

    const game = reg.get(meta.id);
    assert.ok(
      await game.playerStore.get('c1'),
      'player record survives the second join'
    );

    for (const ev of [
      'location-update',
      'player-attack',
      'player-shield',
      'player-respawn',
    ]) {
      assert.equal(
        sock.listenerCount(ev), 1, `exactly one ${ev} listener`
      );
    }

    // Spy on the game-state methods the handlers delegate to.
    let attacks = 0;
    const origAttack = game.attack.bind(game);
    game.attack = async (...a) => { attacks += 1; return origAttack(...a); };
    let locs = 0;
    const origLoc = game.updateLocation.bind(game);
    game.updateLocation = async (...a) => {
      locs += 1;
      return origLoc(...a);
    };

    await sock.trigger('player-attack', { heading: 0 });
    assert.equal(attacks, 1, 'player-attack handled exactly once');
    await sock.trigger('location-update', { lat: 51.5, lng: -0.12 });
    assert.equal(locs, 1, 'location-update handled exactly once');
  }
);

test('swapSocketId is a no-op when oldId equals newId', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'SwapNoop', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));

  const s1 = multiSocket('s1', io);
  await reg.join(meta.id, s1, 'Alice', 'sess-1');

  const game = reg.get(meta.id);
  await game.swapSocketId('s1', 's1');
  const p = await game.playerStore.get('s1');
  assert.ok(p, 'record survives an identity re-key');
  assert.equal(p.id, 's1');
});
