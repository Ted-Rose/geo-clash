import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry } from '../src/roomRegistry.js';
import { leaderboardStore } from '../src/memoryStore.js';

function makeIoStub() {
  const events = [];
  const rooms = new Map();
  function room(id) {
    if (!rooms.has(id)) rooms.set(id, new Set());
    return rooms.get(id);
  }
  return {
    _events: events,
    to: (id) => ({
      emit(event, payload) { events.push({ scope: id, event, payload }); },
    }),
    in: (id) => ({
      async fetchSockets() { return [...room(id)]; },
    }),
    emit(event, payload) { events.push({ scope: '*', event, payload }); },
  };
}

function fakeSocket(id) {
  return { id, data: {}, join() {}, leave() {} };
}

test('endMatch archives players to the leaderboard store', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'Sweep', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));
  await reg.join(meta.id, fakeSocket('p1'), 'Alice');
  await reg.join(meta.id, fakeSocket('p2'), 'Bob');
  const game = reg.get(meta.id);
  await game.endMatch();
  const top = await leaderboardStore.top(50);
  const names = top.map((e) => e.name);
  assert.ok(names.includes('Alice'), 'Alice archived');
  assert.ok(names.includes('Bob'), 'Bob archived');
});

test('leaving last player destroys the room', async () => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'Empty', maxPlayers: 4 });
  const s1 = fakeSocket('only');
  await reg.join(meta.id, s1, 'Solo');
  assert.ok(reg.get(meta.id), 'room exists after join');
  await reg.leave(meta.id, s1);
  // Allow event-loop drain — auto-destroy runs synchronously within leave().
  assert.equal(reg.get(meta.id), null, 'room removed after empty');
  const list = await reg.list();
  assert.equal(list.find((r) => r.id === meta.id), undefined, 'no longer in index');
});

test('match-end event includes the archived leaderboard slice', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'Final', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));
  await reg.join(meta.id, fakeSocket('A'), 'A');
  await reg.join(meta.id, fakeSocket('B'), 'B');
  io._events.length = 0;
  await reg.get(meta.id).endMatch();
  const matchEnd = io._events.find((e) => e.event === 'match-end');
  assert.ok(matchEnd, 'match-end emitted');
  assert.ok(Array.isArray(matchEnd.payload.leaderboard), 'leaderboard array present');
  assert.equal(matchEnd.payload.leaderboard.length, 2);
});
