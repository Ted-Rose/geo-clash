import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryStore,
  MemoryLeaderboardStore,
  makeRoomStores,
  leaderboardStore,
} from '../src/shared/memoryStore.js';

test('makeRoomStores returns three independent stores', async () => {
  const a = makeRoomStores('A');
  const b = makeRoomStores('B');
  await a.playerStore.set('p1', { id: 'p1' });
  assert.equal((await a.playerStore.get('p1'))?.id, 'p1');
  assert.equal(await b.playerStore.get('p1'), undefined);
  assert.ok(a.projectileStore instanceof MemoryStore);
});

test('MemoryLeaderboardStore archives, sorts, caps', async () => {
  const lb = new MemoryLeaderboardStore({ cap: 3 });
  for (const [id, score] of [['a', 5], ['b', 2], ['c', 9], ['d', 1]]) {
    await lb.archive({
      playerId: id, matchId: 'm', name: id, color: '#fff',
      score, metric: 'squares', gameType: 'clash', finishedAt: 0, roomName: 'r',
    });
  }
  const top = await lb.top(10);
  assert.equal(top.length, 3);
  assert.deepEqual(top.map((e) => e.score), [9, 5, 2]);
});

test('exported leaderboardStore answers top()', async () => {
  // memory mode in tests; just smoke-check the API surface.
  const top = await leaderboardStore.top(5);
  assert.ok(Array.isArray(top));
});

test('MemoryStore full CRUD surface (get/set/del/has/keys/all/clear/size)', async () => {
  const s = new MemoryStore();

  assert.equal(await s.get('a'), undefined);
  await s.set('a', 1);
  await s.set('b', { x: true });
  await s.set('gone', undefined); // Map stores it; all() skips undefined
  assert.equal(await s.get('a'), 1);
  assert.equal(await s.has('a'), true);
  assert.equal(await s.has('nope'), false);

  assert.deepEqual((await s.keys()).sort(), ['a', 'b', 'gone']);
  // all() filters entries whose value is undefined
  assert.deepEqual(new Map(await s.all()), new Map([['a', 1], ['b', { x: true }]]));
  assert.equal(s.size(), 3, 'size() counts raw Map entries');

  assert.equal(await s.del('a'), true);
  assert.equal(await s.del('a'), false);

  await s.clear();
  assert.deepEqual(await s.keys(), []);
  assert.equal(s.size(), 0);
});
