import test from 'node:test';
import assert from 'node:assert/strict';
import { ValkeyZSetStore } from '../src/valkeyStore.js';

// Minimal in-memory ZSET shim of the ioredis methods ValkeyZSetStore exercises.
class FakeZRedis {
  constructor() { this._z = new Map(); /* key -> Map<member, score> */ }
  _get(k) { if (!this._z.has(k)) this._z.set(k, new Map()); return this._z.get(k); }
  async zadd(key, ...args) {
    const z = this._get(key);
    let added = 0;
    for (let i = 0; i < args.length; i += 2) {
      const score = Number(args[i]);
      const member = args[i + 1];
      if (!z.has(member)) added += 1;
      z.set(member, score);
    }
    return added;
  }
  _sortedDesc(key) {
    return [...this._get(key).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  async zrevrange(key, start, stop, withScores) {
    const arr = this._sortedDesc(key);
    const slice = arr.slice(start, stop === -1 ? undefined : stop + 1);
    const out = [];
    for (const [m, s] of slice) {
      out.push(m);
      if (withScores === 'WITHSCORES') out.push(String(s));
    }
    return out;
  }
  async zrange(key, start, stop) {
    const arr = [...this._get(key).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    return arr.slice(start, stop === -1 ? undefined : stop + 1).map(([m]) => m);
  }
  async zcard(key) { return this._get(key).size; }
  async zremrangebyrank(key, start, stop) {
    // ascending order ranking
    const arr = [...this._get(key).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    const len = arr.length;
    const norm = (i) => (i < 0 ? Math.max(0, len + i) : Math.min(len - 1, i));
    const lo = norm(start);
    const hi = norm(stop);
    if (lo > hi) return 0;
    const z = this._get(key);
    let removed = 0;
    for (let i = lo; i <= hi; i++) {
      z.delete(arr[i][0]);
      removed += 1;
    }
    return removed;
  }
  async del(...keys) {
    let n = 0;
    for (const k of keys) if (this._z.delete(k)) n += 1;
    return n;
  }
}

test('ZSetStore add/topRev returns descending', async () => {
  const r = new FakeZRedis();
  const z = new ValkeyZSetStore('lb', r);
  await z.add('a', 5);
  await z.add('b', 9);
  await z.add('c', 2);
  const top = await z.topRev(2);
  assert.deepEqual(top, [{ member: 'b', score: 9 }, { member: 'a', score: 5 }]);
  assert.equal(await z.size(), 3);
});

test('ZSetStore trimToCap removes lowest scores', async () => {
  const r = new FakeZRedis();
  const z = new ValkeyZSetStore('lb', r);
  for (const [m, s] of [['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]]) {
    await z.add(m, s);
  }
  await z.trimToCap(3);
  assert.equal(await z.size(), 3);
  const top = await z.topRev(10);
  assert.deepEqual(top.map((e) => e.member), ['e', 'd', 'c']);
});

test('ZSetStore addMany batches inserts', async () => {
  const r = new FakeZRedis();
  const z = new ValkeyZSetStore('lb', r);
  await z.addMany([{ member: 'a', score: 1 }, { member: 'b', score: 7 }]);
  assert.equal(await z.size(), 2);
});
