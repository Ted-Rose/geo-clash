import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry } from '../src/roomRegistry.js';

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

test('RoomRegistry.create produces unique ids under contention (50x parallel, same name)', async () => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const N = 50;
  const before = (await reg.list()).length;
  const results = await Promise.allSettled(
    Array.from({ length: N }, (_, i) =>
      reg.create({ name: 'Park', hostId: `h${i}` })
    )
  );
  for (const r of results) assert.equal(r.status, 'fulfilled', 'no creator threw');
  const ids = new Set(results.map((r) => r.value.id));
  assert.equal(ids.size, N, 'every id is unique');
  const list = await reg.list();
  assert.equal(list.length - before, N, 'index grew by exactly N');
  // status starts as lobby
  for (const r of list) assert.equal(r.status, 'lobby');
  // exhaustively verify every returned id is queryable
  for (const r of results) {
    assert.ok(reg.get(r.value.id), 'in-memory game exists');
  }
});

test('RoomRegistry.join enforces capacity', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const room = await reg.create({ name: 't', maxPlayers: 2 });
  t.after(async () => { await reg.destroy(room.id); });
  let i = 0;
  function fakeSocket() {
    const id = `s${i++}`;
    return {
      id,
      data: {},
      join() {},
      leave() {},
    };
  }
  const a = await reg.join(room.id, fakeSocket(), 'A');
  const b = await reg.join(room.id, fakeSocket(), 'B');
  const c = await reg.join(room.id, fakeSocket(), 'C');
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'room-full');
});

test('RoomRegistry.destroy removes from list', async () => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const room = await reg.create({ name: 'tmp' });
  await reg.destroy(room.id);
  const list = await reg.list();
  assert.equal(list.find((r) => r.id === room.id), undefined);
});
