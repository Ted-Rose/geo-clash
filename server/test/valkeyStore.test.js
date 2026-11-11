// Unit tests for ValkeyStore — the KV half of shared/valkeyStore.js —
// against a fake ioredis client.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ValkeyStore } from '../src/shared/valkeyStore.js';

// In-memory string KV shim of the ioredis methods ValkeyStore exercises.
class FakeKvRedis {
  constructor() { this._kv = new Map(); }
  async get(key) { return this._kv.has(key) ? this._kv.get(key) : null; }
  async set(key, value) { this._kv.set(key, String(value)); return 'OK'; }
  // ioredis flattens del(['a','b']) — tolerate both call shapes.
  async del(...keys) {
    let n = 0;
    for (const k of keys.flat()) if (this._kv.delete(k)) n += 1;
    return n;
  }
  async exists(key) { return this._kv.has(key) ? 1 : 0; }
  async keys(pattern) {
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    return [...this._kv.keys()].filter((k) => k.startsWith(prefix));
  }
}

test('ValkeyStore get/set JSON round-trip; missing key → undefined', async () => {
  const r = new FakeKvRedis();
  const store = new ValkeyStore('pfx', r);

  await store.set('k', { a: 1 });
  assert.deepEqual(await store.get('k'), { a: 1 });

  assert.equal(await store.get('missing'), undefined, 'missing → undefined');

  for (const v of [null, 0, false, 's', [1, 2]]) {
    await store.set('edge', v);
    assert.deepEqual(await store.get('edge'), v, `round-trips ${JSON.stringify(v)}`);
  }
});

test('ValkeyStore del/has/keys with prefix stripping', async () => {
  const r = new FakeKvRedis();
  const store = new ValkeyStore('pfx', r);

  await store.set('a', 1);
  await store.set('b', 2);
  // A foreign-prefix key must not leak through keys().
  await r.set('other:c', '3');

  assert.equal(await store.has('a'), true);
  assert.equal(await store.del('a'), true);
  assert.equal(await store.del('a'), false, 'second del reports not-found');
  assert.equal(await store.has('a'), false);

  assert.deepEqual(await store.keys(), ['b'], 'only local keys, prefix stripped');
});

test('ValkeyStore all() and clear() cover only prefixed keys; size() is 0', async () => {
  const r = new FakeKvRedis();
  const store = new ValkeyStore('pfx', r);

  await store.set('a', 1);
  await store.set('b', { x: true });
  // A tombstone: raw key exists but reads back as undefined is not
  // reachable via this impl (get returns parsed JSON), so all() simply
  // returns every live entry.
  await r.set('other:c', '3');

  const all = await store.all();
  assert.deepEqual(new Map(all), new Map([['a', 1], ['b', { x: true }]]));

  assert.equal(store.size(), 0, 'size() pinned as documented quirk (no KEYS scan)');

  await store.clear();
  assert.deepEqual(await store.keys(), [], 'clear emptied the prefix');
  assert.equal(await r.get('other:c'), '3', 'foreign prefix untouched');
});
