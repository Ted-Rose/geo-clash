import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryLeaderboardStore } from '../src/shared/memoryStore.js';

test('top() filters by gameType when provided', async () => {
  const lb = new MemoryLeaderboardStore();
  await lb.archive({
    playerId: 'p1', matchId: 'm1', name: 'Alice', color: '#f00',
    score: 10, metric: 'squares', gameType: 'clash', finishedAt: 0, roomName: 'r',
  });
  await lb.archive({
    playerId: 'p2', matchId: 'm2', name: 'Bob', color: '#0f0',
    score: 20, metric: 'kills', gameType: 'snake', finishedAt: 0, roomName: 'r',
  });
  const clashTop = await lb.top(10, { gameType: 'clash' });
  assert.equal(clashTop.length, 1);
  assert.equal(clashTop[0].name, 'Alice');
  const snakeTop = await lb.top(10, { gameType: 'snake' });
  assert.equal(snakeTop.length, 1);
  assert.equal(snakeTop[0].name, 'Bob');
  const allTop = await lb.top(10);
  assert.equal(allTop.length, 2);
});

test('backward compat: squaresCaptured alias accepted', async () => {
  const lb = new MemoryLeaderboardStore();
  await lb.archive({
    playerId: 'p1', matchId: 'm1', name: 'Alice', color: '#f00',
    squaresCaptured: 7, finishedAt: 0, roomName: 'r',
  });
  const top = await lb.top(5);
  assert.equal(top[0].score, 7);
});
