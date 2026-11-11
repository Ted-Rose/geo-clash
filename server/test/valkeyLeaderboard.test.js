// Unit tests for ValkeyLeaderboardStore against a fake ioredis client
// that covers both the ZSET and string-KV surface it exercises.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ValkeyLeaderboardStore } from '../src/shared/memoryStore.js';

// Combined ZSET + string-KV fake of ioredis.
class FakeKvZRedis {
  constructor() {
    this._z = new Map();  // zset key -> Map<member, score>
    this._kv = new Map(); // key -> string
  }
  _get(k) { if (!this._z.has(k)) this._z.set(k, new Map()); return this._z.get(k); }
  _sortedAsc(key) {
    return [...this._get(key).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  }
  async zadd(key, ...args) {
    const z = this._get(key);
    for (let i = 0; i < args.length; i += 2) z.set(args[i + 1], Number(args[i]));
    return 1;
  }
  async zrevrange(key, start, stop, withScores) {
    const arr = this._sortedAsc(key).reverse();
    const slice = arr.slice(start, stop === -1 ? undefined : stop + 1);
    const out = [];
    for (const [m, s] of slice) {
      out.push(m);
      if (withScores === 'WITHSCORES') out.push(String(s));
    }
    return out;
  }
  async zrange(key, start, stop) {
    return this._sortedAsc(key)
      .slice(start, stop === -1 ? undefined : stop + 1)
      .map(([m]) => m);
  }
  async zremrangebyrank(key, start, stop) {
    // Match real Redis index normalization: negative indexes are offset
    // from the end; an end still below 0 afterwards means an empty range.
    const arr = this._sortedAsc(key);
    const len = arr.length;
    const lo = start < 0 ? Math.max(0, len + start) : start;
    const hi = stop < 0 ? len + stop : Math.min(len - 1, stop);
    if (lo > hi || lo >= len) return 0;
    const z = this._get(key);
    let removed = 0;
    for (let i = lo; i <= hi; i++) { z.delete(arr[i][0]); removed += 1; }
    return removed;
  }
  async get(k) { return this._kv.has(k) ? this._kv.get(k) : null; }
  async set(k, v) { this._kv.set(k, String(v)); return 'OK'; }
  async del(...keys) {
    let n = 0;
    for (const k of keys.flat()) {
      if (this._z.delete(k)) n += 1;
      if (this._kv.delete(k)) n += 1;
    }
    return n;
  }
}

const entry = (id, score, gameType = 'clash', match = 'm1') => ({
  playerId: id, matchId: match, name: `N-${id}`, color: '#fff',
  score, metric: gameType === 'snake' ? 'kills' : 'squares',
  gameType, finishedAt: 123, roomName: 'R',
});

test('archive() writes gameType + all zsets and meta hash; top() merges meta', async () => {
  const r = new FakeKvZRedis();
  const lb = new ValkeyLeaderboardStore(r);

  await lb.archive(entry('p1', 20, 'snake'));

  const member = 'p1:m1';
  assert.deepEqual(r._z.get('leaderboard:snake').get(member), 20, 'gameType zset');
  assert.deepEqual(r._z.get('leaderboard:all').get(member), 20, 'all zset');
  const meta = JSON.parse(r._kv.get(`leaderboard:meta:${member}`));
  assert.equal(meta.name, 'N-p1');
  assert.equal(meta.gameType, 'snake');
  assert.equal(meta.finishedAt, 123);
  assert.equal(meta.roomName, 'R');

  const top = await lb.top(5, { gameType: 'snake' });
  assert.equal(top.length, 1);
  assert.equal(top[0].member, member);
  assert.equal(top[0].score, 20);
  assert.equal(top[0].name, 'N-p1', 'meta merged into top() rows');
});

test('top() filters by gameType; omitting uses the all zset', async () => {
  const r = new FakeKvZRedis();
  const lb = new ValkeyLeaderboardStore(r);

  await lb.archive(entry('c1', 10, 'clash'));
  await lb.archive(entry('s1', 30, 'snake'));

  const clashTop = await lb.top(10, { gameType: 'clash' });
  assert.deepEqual(clashTop.map((e) => e.member), ['c1:m1']);

  const all = await lb.top(10);
  assert.deepEqual(all.map((e) => e.member), ['s1:m1', 'c1:m1'], 'all zset sorted desc');
});

test('cap trim applies on archive; clear() empties zsets and meta keys', async () => {
  const r = new FakeKvZRedis();
  const lb = new ValkeyLeaderboardStore(r, { cap: 2 });

  await lb.archive(entry('a', 1));
  await lb.archive(entry('b', 5));
  await lb.archive(entry('c', 9));

  assert.equal(r._z.get('leaderboard:clash').size, 2, 'gameType zset trimmed');
  const top = await lb.top(10, { gameType: 'clash' });
  assert.deepEqual(top.map((e) => e.member), ['c:m1', 'b:m1'], 'lowest trimmed');

  await lb.clear();
  for (const gt of ['all', 'clash', 'snake']) {
    assert.equal((r._z.get(`leaderboard:${gt}`) || new Map()).size, 0, `${gt} zset empty`);
  }
  const metaKeys = [...r._kv.keys()].filter((k) => k.startsWith('leaderboard:meta:'));
  assert.deepEqual(metaKeys, [], 'meta keys deleted');
});
