import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry } from '../../src/roomRegistry.js';
import { SnakeGameState } from '../../src/snake/gameState.js';

// Minimal io stub: tracks emit/to/in/fetchSockets used by the registry.
function makeIoStub() {
  const events = [];
  const rooms = new Map(); // roomId -> Set<socket>
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

function makeGameIo() {
  const events = [];
  return {
    _events: events,
    to: () => ({ emit: (e, p) => events.push({ event: e, payload: p }) }),
    emit: (e, p) => events.push({ event: e, payload: p }),
  };
}

let sockSeq = 0;
function fakeSocket(id) {
  return {
    id: id || `s${sockSeq++}`,
    data: {},
    emitted: [],
    join() {},
    leave() {},
    on() {},
    emit(event, payload) { this.emitted.push({ event, payload }); },
  };
}

test('snake session interface: addPlayer stores sessionId, ' +
  'getPlayerBySessionId finds it', async (t) => {
  const io = makeGameIo();
  const game = new SnakeGameState({ io, roomId: 'snake-session-test' });
  t.after(() => game.endMatch());

  await game.addPlayer('p1', 'Alice', 'sess-1');
  const found = await game.getPlayerBySessionId('sess-1');
  assert.ok(found, 'player found by sessionId');
  assert.equal(found.socketId, 'p1');
  assert.equal(found.player.name, 'Alice');
  assert.equal(await game.getPlayerBySessionId('nope'), null);
  assert.equal(await game.getPlayerBySessionId(null), null);
});

test('snake swapSocketId re-keys record and migrates clashes', async (t) => {
  const io = makeGameIo();
  const game = new SnakeGameState({ io, roomId: 'snake-swap-test' });
  t.after(() => game.endMatch());

  await game.addPlayer('old', 'Alice', 'sess-1');
  await game.updateLocation('old', 51.5, -0.12, 90, [{ lat: 1, lng: 2 }], 7);
  game._pendingClashes.set('old:123', {
    victimId: 'old',
    killerId: 'killer-1',
    acksNeeded: new Set(['old', 'killer-1']),
    timestamp: Date.now(),
  });

  await game.swapSocketId('old', 'new');

  assert.equal(
    await game.playerStore.get('old'),
    undefined,
    'old key removed',
  );
  const p = await game.playerStore.get('new');
  assert.ok(p, 'record re-keyed to new socket id');
  assert.equal(p.id, 'new');
  assert.equal(p.connected, true);
  assert.equal(p.score, 7, 'score preserved');
  assert.deepEqual(p.tailPoints, [{ lat: 1, lng: 2 }], 'tail preserved');
  assert.equal(p.heading, 90, 'heading preserved');

  const entry = game._pendingClashes.get('old:123');
  assert.equal(entry.victimId, 'new', 'clash victim re-keyed');
  assert.equal(entry.killerId, 'killer-1');
  assert.ok(entry.acksNeeded.has('new'), 'acksNeeded re-keyed');
  assert.ok(!entry.acksNeeded.has('old'));
});

test('registry: snake rejoin with sessionId preserves player, ' +
  'dodges room-full', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const room = await reg.create({
    name: 'snake-room',
    gameType: 'snake',
    maxPlayers: 2,
  });
  t.after(() => reg.destroy(room.id));

  const sA = fakeSocket('sA');
  const joinA = await reg.join(room.id, sA, 'Alice', 'sess-A');
  assert.equal(joinA.ok, true);

  // Give Alice some state worth preserving.
  const game = reg.get(room.id);
  const tail = [{ lat: 51.5, lng: -0.12 }, { lat: 51.5001, lng: -0.12 }];
  await game.updateLocation('sA', 51.5, -0.12, 45, tail, 7);

  // Fill the room.
  const sB = fakeSocket('sB');
  const joinB = await reg.join(room.id, sB, 'Bob', 'sess-B');
  assert.equal(joinB.ok, true);

  // Alice drops (soft disconnect).
  await reg.softDisconnect(room.id, sA);
  assert.equal(reg._disconnectTimers.has('sA'), true, 'grace timer armed');
  const soft = await game.playerStore.get('sA');
  assert.equal(soft.connected, false, 'marked disconnected');

  // Alice rejoins on a new socket with the same sessionId.
  const sA2 = fakeSocket('sA2');
  const rejoin = await reg.join(room.id, sA2, 'Alice', 'sess-A');
  assert.equal(rejoin.ok, true, 'rejoin accepted despite full room');
  assert.equal(rejoin.reconnected, true);

  // Player record re-keyed, state preserved.
  assert.equal(
    await game.playerStore.get('sA'),
    undefined,
    'stale record gone',
  );
  const p = await game.playerStore.get('sA2');
  assert.ok(p, 'record re-keyed to new socket');
  assert.equal(p.connected, true);
  assert.equal(p.score, 7, 'score preserved');
  assert.deepEqual(p.tailPoints, tail, 'tail preserved');
  assert.equal(p.sessionId, 'sess-A');

  // Grace timer cancelled — the stale record must not be hard-left later.
  assert.equal(
    reg._disconnectTimers.has('sA'),
    false,
    'disconnect timer cancelled',
  );

  // Rejoining socket got joined + snapshot; room got player-reconnected.
  const evNames = sA2.emitted.map((e) => e.event);
  assert.ok(evNames.includes('joined'), 'joined emitted to rejoining socket');
  assert.ok(evNames.includes('snapshot'), 'snapshot emitted');
  const recon = io._events.find((e) => e.event === 'player-reconnected');
  assert.ok(recon, 'player-reconnected broadcast');
  assert.deepEqual(recon.payload, { id: 'sA2', oldId: 'sA' });
  assert.equal(
    io._events.some((e) => e.event === 'player-joined' &&
      e.payload?.id === 'sA2'),
    false,
    'no player-joined for a reconnect',
  );

  // Room is still full for genuinely new sessions.
  const sC = fakeSocket('sC');
  const joinC = await reg.join(room.id, sC, 'Carol', 'sess-C');
  assert.equal(joinC.ok, false);
  assert.equal(joinC.reason, 'room-full');
});

test('snake payload relays connected across softDisconnect/rejoin',
  async (t) => {
    const io = makeIoStub();
    const reg = new RoomRegistry(io);
    const room = await reg.create({
      name: 'snake-conn-room',
      gameType: 'snake',
      maxPlayers: 4,
    });
    t.after(() => reg.destroy(room.id));

    const sA = fakeSocket('sA');
    const sB = fakeSocket('sB');
    await reg.join(room.id, sA, 'Alice', 'sess-A');
    await reg.join(room.id, sB, 'Bob', 'sess-B');
    const game = reg.get(room.id);

    const playerIn = (snap, id) =>
      snap.players.find((p) => p.id === id);

    // Everyone reports connected on join.
    let snap = await game.snapshot();
    assert.equal(playerIn(snap, 'sA').connected, true);
    assert.equal(playerIn(snap, 'sB').connected, true);

    // Soft disconnect → flag flips false in snapshot and snake-update.
    await reg.softDisconnect(room.id, sA);
    snap = await game.snapshot();
    assert.equal(
      playerIn(snap, 'sA').connected,
      false,
      'snapshot reports the drop',
    );
    io._events.length = 0;
    await game._tick();
    const upd = io._events.find((e) => e.event === 'snake-update');
    assert.ok(upd, 'snake-update emitted on tick');
    assert.equal(
      upd.payload.players.find((p) => p.id === 'sA').connected,
      false,
      'snake-update reports the drop',
    );

    // Session rejoin (swapSocketId) → flag back to true.
    const sA2 = fakeSocket('sA2');
    const rejoin = await reg.join(room.id, sA2, 'Alice', 'sess-A');
    assert.equal(rejoin.ok, true);
    snap = await game.snapshot();
    assert.equal(
      playerIn(snap, 'sA2').connected,
      true,
      'rejoined player reports connected',
    );
  });
