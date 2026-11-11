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
    off(ev, cb) {
      const cbs = this._handlers.get(ev) || [];
      this._handlers.set(ev, cbs.filter((x) => x !== cb));
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

test('snake swapSocketId is a no-op when oldId equals newId',
  async (t) => {
    const io = makeIoStub();
    const reg = new RoomRegistry(io);
    const meta = await reg.create(
      { name: 'SnakeSwap', maxPlayers: 4, gameType: 'snake' }
    );
    t.after(() => reg.destroy(meta.id));

    const s1 = multiSocket('s1', io);
    await reg.join(meta.id, s1, 'Bob', 'sess-2');

    const game = reg.get(meta.id);
    await game.swapSocketId('s1', 's1');
    const p = await game.playerStore.get('s1');
    assert.ok(p, 'snake record survives an identity re-key');
    assert.equal(p.id, 's1');
  }
);

test('snake room rejoin keeps one listener per event', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  registerSocketHandlers(io, reg);
  const meta = await reg.create(
    { name: 'SnakeTwice', maxPlayers: 4, gameType: 'snake' }
  );
  t.after(() => reg.destroy(meta.id));

  const sock = multiSocket('n1', io);
  await io._conn(sock);

  const ack1 = ackSpy();
  await sock.trigger('room-join',
    { roomId: meta.id, name: 'S', sessionId: 'sess-s' }, ack1);
  assert.equal(ack1.calls[0][0].ok, true);

  const ack2 = ackSpy();
  await sock.trigger('room-join',
    { roomId: meta.id, name: 'S', sessionId: 'sess-s' }, ack2);
  const res2 = ack2.calls[0][0];
  assert.equal(res2.ok, true);
  assert.equal(res2.reconnected, true);

  const game = reg.get(meta.id);
  assert.ok(
    await game.playerStore.get('n1'),
    'snake record survives the second join'
  );

  for (const ev of ['location-update', 'eat_food', 'clash_ack']) {
    assert.equal(
      sock.listenerCount(ev), 1, `exactly one ${ev} listener`
    );
  }

  let eats = 0;
  game.eatFood = async () => { eats += 1; };
  await sock.trigger('eat_food', { foodId: 'f-1' });
  assert.equal(eats, 1, 'eat_food handled exactly once');
});

test('recovered socket re-registers handlers and flips connected',
  async (t) => {
    const io = makeIoStub();
    const reg = new RoomRegistry(io);
    registerSocketHandlers(io, reg);
    const meta = await reg.create({ name: 'Rec', maxPlayers: 4 });
    t.after(() => reg.destroy(meta.id));

    // Original socket joins, then drops — softDisconnect marks the
    // player offline.
    const old = multiSocket('r1', io);
    await io._conn(old);
    const ack1 = ackSpy();
    await old.trigger('room-join',
      { roomId: meta.id, name: 'A', sessionId: 'sess-r' }, ack1);
    assert.equal(ack1.calls[0][0].ok, true);
    const game = reg.get(meta.id);
    await reg.softDisconnect(meta.id, old);
    let p = await game.playerStore.get('r1');
    assert.equal(p.connected, false, 'soft disconnect went offline');
    io._events.length = 0;

    // connectionStateRecovery spins up a NEW Socket instance with the
    // same id: socket.data is restored (a stale handlersRegistered
    // flag from an older build included) but the listeners and the
    // _handlersFor binding are not.
    const sock = multiSocket('r1', io);
    sock.data = {
      ...old.data,
      roomId: meta.id,
      handlersRegistered: true,
    };
    await io._conn(sock);
    const ack2 = ackSpy();
    await sock.trigger('room-join',
      { roomId: meta.id, name: 'A', sessionId: 'sess-r' }, ack2);
    const res2 = ack2.calls[0][0];
    assert.equal(res2.ok, true);
    assert.equal(res2.reconnected, true);

    for (const ev of [
      'location-update',
      'player-attack',
      'player-shield',
      'player-respawn',
    ]) {
      assert.equal(
        sock.listenerCount(ev), 1,
        `exactly one ${ev} listener on the recovered socket`
      );
    }

    p = await game.playerStore.get('r1');
    assert.equal(p.connected, true, 'player back online in the store');
    assert.ok(
      io._events.find((e) => e.event === 'player-reconnected'),
      'peers see player-reconnected after a disconnected rejoin'
    );
    const snap = sock._emitted.find((e) => e.event === 'snapshot');
    const snapP = snap.payload.players.find((x) => x.id === 'r1');
    assert.equal(snapP.connected, true, 'snapshot reports online');
  }
);

test('joining a different room re-binds handlers to the new game',
  async (t) => {
    const io = makeIoStub();
    const reg = new RoomRegistry(io);
    registerSocketHandlers(io, reg);
    const metaA = await reg.create({ name: 'A', maxPlayers: 4 });
    const metaB = await reg.create(
      { name: 'B', maxPlayers: 4, gameType: 'snake' }
    );
    t.after(() => reg.destroy(metaA.id));
    t.after(() => reg.destroy(metaB.id));

    const sock = multiSocket('m1', io);
    await io._conn(sock);
    const ack1 = ackSpy();
    await sock.trigger('room-join',
      { roomId: metaA.id, name: 'A', sessionId: 'sess-m' }, ack1);
    assert.equal(ack1.calls[0][0].ok, true);
    assert.equal(
      sock.listenerCount('player-attack'), 1, 'clash handler bound'
    );
    const gameA = reg.get(metaA.id);
    const gameB = reg.get(metaB.id);

    // Leaving the room detaches its gameplay listeners.
    await reg.leave(metaA.id, sock);
    assert.equal(
      sock.listenerCount('player-attack'), 0,
      'clash listeners detached on leave'
    );

    // Joining a snake room binds the snake handler set.
    const ack2 = ackSpy();
    await sock.trigger('room-join',
      { roomId: metaB.id, name: 'A', sessionId: 'sess-m' }, ack2);
    assert.equal(ack2.calls[0][0].ok, true);
    assert.equal(
      sock.listenerCount('player-attack'), 0,
      'no stale clash listener after rebind'
    );
    for (const ev of ['location-update', 'eat_food', 'clash_ack']) {
      assert.equal(
        sock.listenerCount(ev), 1, `exactly one ${ev} listener`
      );
    }

    let locsA = 0;
    gameA.updateLocation = async () => { locsA += 1; };
    let locsB = 0;
    const origLocB = gameB.updateLocation.bind(gameB);
    gameB.updateLocation = async (...a) => {
      locsB += 1;
      return origLocB(...a);
    };
    await sock.trigger('location-update',
      { lat: 51.5, lng: -0.12, tailPoints: [], score: 1 });
    assert.equal(locsB, 1, 'location-update routed to the snake game');
    assert.equal(locsA, 0, 'stale clash game untouched');
  }
);

test('double-join while handlers are live never stacks listeners',
  async (t) => {
    const io = makeIoStub();
    const reg = new RoomRegistry(io);
    registerSocketHandlers(io, reg);
    const meta = await reg.create({ name: 'Live', maxPlayers: 4 });
    t.after(() => reg.destroy(meta.id));

    const sock = multiSocket('d1', io);
    await io._conn(sock);
    const join = () => sock.trigger('room-join',
      { roomId: meta.id, name: 'A', sessionId: 'sess-d' }, ackSpy());
    await join();
    await join();
    await join();

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
    assert.equal(
      io._events.find((e) => e.event === 'player-reconnected'),
      undefined,
      'still-connected rejoins broadcast nothing'
    );
  }
);
