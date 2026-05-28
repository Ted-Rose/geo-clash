import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryStore,
  MemoryLeaderboardStore,
  makeRoomStores,
  leaderboardStore,
} from '../src/memoryStore.js';

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
      squaresCaptured: score, finishedAt: 0, roomName: 'r',
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
