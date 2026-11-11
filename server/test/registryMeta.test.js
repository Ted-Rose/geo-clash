// Tests for RoomRegistry init/list/meta shape/broadcast — the parts that
// back the lobby's rooms-updated feed.

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

function fakeSocket(id) {
  return { id, data: {}, join() {}, leave() {} };
}

test('init() purges stale index + meta entries', async () => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  // Simulate leftovers from a previous server process.
  reg._index._local.add('stale-id');
  await reg._metaStore.set('stale-id', { id: 'stale-id', status: 'lobby' });

  await reg.init();

  assert.deepEqual(await reg.list(), [], 'list empty after purge');
  assert.equal(await reg._metaStore.get('stale-id'), undefined, 'meta purged');
  assert.deepEqual(await reg._index.members(), [], 'index cleared');
});

test('list() sorts by createdAt desc and tracks playerCount', async (t) => {
  const io = makeIoStub();
  let now = 100;
  const reg = new RoomRegistry(io, { now: () => now });
  const r1 = await reg.create({ name: 'one' });
  t.after(() => reg.destroy(r1.id));
  now = 200;
  const r2 = await reg.create({ name: 'two' });
  t.after(() => reg.destroy(r2.id));

  const list = await reg.list();
  assert.equal(list[0].id, r2.id, 'newest room first');
  assert.equal(list[1].id, r1.id);

  const s1 = fakeSocket('s1');
  await reg.join(r1.id, s1, 'A');
  let listed = (await reg.list()).find((r) => r.id === r1.id);
  assert.equal(listed.playerCount, 1);
  await reg.leave(r1.id, s1);
  listed = (await reg.list()).find((r) => r.id === r1.id);
  assert.equal(listed, undefined, 'room auto-destroyed once empty');
});

test('create() meta shape: default name, null center, per-gameType fields', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);

  const clash = await reg.create({ maxAmmo: 5 });
  t.after(() => reg.destroy(clash.id));
  assert.equal(clash.name, `Room-${clash.id.slice(-4)}`, 'default name');
  assert.equal(clash.centerLat, null, 'non-number centerLat → null');
  assert.equal(clash.centerLng, null);
  assert.equal(clash.hostId, null);
  assert.equal(clash.status, 'lobby');
  assert.equal(clash.gameType, 'clash');
  assert.equal(clash.maxAmmo, 5, 'maxAmmo lands in meta when set');
  assert.equal(clash.ammoRenewalMs, 5000);

  const clashNoAmmo = await reg.create({});
  t.after(() => reg.destroy(clashNoAmmo.id));
  assert.ok(!('maxAmmo' in clashNoAmmo), 'maxAmmo key absent when null');
  assert.ok(!('ammoRenewalMs' in clashNoAmmo));

  const snake = await reg.create({ gameType: 'snake' });
  t.after(() => reg.destroy(snake.id));
  assert.equal(snake.foodCountTarget, 5);
  assert.equal(snake.foodRespawnIntervalMs, 2000);
  assert.equal(snake.arenaSideMeters, 50);
  assert.equal(snake.timeLimitMs, 0);
});

test('_broadcastList emits rooms-updated with current metas', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'BCast', maxPlayers: 4 });
  t.after(() => reg.destroy(meta.id));
  const s1 = fakeSocket('s1');
  await reg.join(meta.id, s1, 'A');

  const last = [...io._events].reverse()
    .find((e) => e.scope === '*' && e.event === 'rooms-updated');
  assert.ok(last, 'rooms-updated broadcast');
  const entry = last.payload.rooms.find((r) => r.id === meta.id);
  assert.ok(entry, 'room meta present in payload');
  assert.equal(entry.playerCount, 1);
  assert.equal(entry.name, 'BCast');
});

test('create() calls initGrid when numeric center provided', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);

  const centered = await reg.create({ centerLat: 51.5, centerLng: -0.12 });
  t.after(() => reg.destroy(centered.id));
  assert.ok(reg.get(centered.id).grid, 'grid built from provided center');

  const centerless = await reg.create({});
  t.after(() => reg.destroy(centerless.id));
  assert.equal(reg.get(centerless.id).grid, null, 'grid stays null without center');
});

test('destroy() is idempotent and safe on re-entry', async (t) => {
  const io = makeIoStub();
  const reg = new RoomRegistry(io);
  const meta = await reg.create({ name: 'Reentry', maxPlayers: 4 });
  const game = reg.get(meta.id);

  // endMatch fires onEnd → destroy() re-entry while we also destroy.
  await game.endMatch();
  await assert.doesNotReject(() => reg.destroy(meta.id));
  await assert.doesNotReject(() => reg.destroy(meta.id));

  assert.equal(reg.get(meta.id), null);
  assert.equal((await reg.list()).find((r) => r.id === meta.id), undefined);
});
