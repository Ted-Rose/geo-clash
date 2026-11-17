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

test('ValkeyStore get/set round-trip; missing key → undefined', async () => {
  const r = new FakeKvRedis();
  const store = new ValkeyStore('pfx', r);

  await store.set('k', { a: 1 });
  assert.deepEqual(await store.get('k'), { a: 1 });

  assert.equal(await store.get('missing'), undefined, 'missing → undefined');

  for (const v of [null, 0, false, 's', [1, 2]]) {
    await store.set('edge', v);
    const label = `round-trips ${JSON.stringify(v)}`;
    assert.deepEqual(await store.get('edge'), v, label);
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

  const keys = await store.keys();
  assert.deepEqual(keys, ['b'], 'only local keys, prefix stripped');
});

// The real ioredis client prepends `options.keyPrefix` to
// command key arguments but never to KEYS patterns — this
// shim models exactly that, mirroring the staging deploy's
// VALKEY_KEY_PREFIX=staging: behaviour.
class KeyPrefixedKvRedis extends FakeKvRedis {
  constructor(keyPrefix) {
    super();
    this.options = { keyPrefix };
  }
  async get(key) { return super.get(this.options.keyPrefix + key); }
  async set(key, value) {
    return super.set(this.options.keyPrefix + key, value);
  }
  async del(...keys) {
    return super.del(...keys.flat().map(k => this.options.keyPrefix + k));
  }
  async exists(key) {
    return super.exists(this.options.keyPrefix + key);
  }
  // No keyPrefix on the pattern — matches real ioredis.
}

test('ValkeyStore keys() honours the client keyPrefix', async () => {
  const r = new KeyPrefixedKvRedis('staging:');
  const store = new ValkeyStore('room:1:players', r);

  await store.set('a', 1);
  await store.set('b', 2);
  // Prod-namespace keys sharing the physical store must not
  // leak through — write them raw (unprefixed).
  await r._kv.set('room:1:players:prod-key', '9');
  await r.set('other:c', '3'); // lands as staging:other:c

  assert.deepEqual(await store.keys(), ['a', 'b'],
    'keys() must scan the prefixed namespace');
  assert.deepEqual(new Map(await store.all()),
    new Map([['a', 1], ['b', 2]]));
  assert.equal(await store.size(), 2);
  assert.equal(await store.get('a'), 1,
    'get() still works through the prefix');

  await store.clear();
  assert.equal(await store.size(), 0);
  assert.equal(r._kv.get('staging:other:c'), '3',
    'foreign prefixed key untouched');
});

test('ValkeyStore all()/clear()/size() cover only prefixed keys', async () => {
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

  assert.equal(await store.size(), 2, 'size() reports the live count');

  await store.clear();
  assert.equal(await store.size(), 0, 'size() is 0 after clear()');
  assert.deepEqual(await store.keys(), [], 'clear emptied the prefix');
  assert.equal(await r.get('other:c'), '3', 'foreign prefix untouched');
});
