// Tests for RoomLock — covers in-process fallback and the Redis CAS-delete
// path against a tiny in-memory fake of ioredis with the bits we exercise.

import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomLock, LockTimeoutError } from '../src/roomLock.js';

class FakeRedis {
  constructor() {
    this._store = new Map();   // key -> { value, expiresAt }
    this.evalCalls = 0;
  }
  _expire(k) {
    const e = this._store.get(k);
    if (e && e.expiresAt && e.expiresAt <= Date.now()) this._store.delete(k);
  }
  async set(key, value, ...flags) {
    this._expire(key);
    let nx = false;
    let pxMs = null;
    for (let i = 0; i < flags.length; i++) {
      const f = String(flags[i]).toUpperCase();
      if (f === 'NX') nx = true;
      else if (f === 'PX') pxMs = Number(flags[++i]);
    }
    if (nx && this._store.has(key)) return null;
    this._store.set(key, {
      value,
      expiresAt: pxMs ? Date.now() + pxMs : 0,
    });
    return 'OK';
  }
  async get(key) {
    this._expire(key);
    return this._store.get(key)?.value ?? null;
  }
  async del(key) {
    return this._store.delete(key) ? 1 : 0;
  }
  async eval(_lua, _numKeys, key, arg) {
    this.evalCalls += 1;
    this._expire(key);
    const cur = this._store.get(key)?.value;
    if (cur === arg) {
      this._store.delete(key);
      return 1;
    }
    return 0;
  }
}

test('local fallback serializes concurrent callers', async () => {
  const lock = new RoomLock(null);
  const order = [];
  const p1 = lock.withLock('k', async () => {
    order.push('a-start');
    await new Promise((r) => setTimeout(r, 20));
    order.push('a-end');
    return 'a';
  });
  const p2 = lock.withLock('k', async () => {
    order.push('b-start');
    return 'b';
  });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, 'a');
  assert.equal(r2, 'b');
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start']);
});

test('local fallback releases on throw and lets next acquire', async () => {
  const lock = new RoomLock(null);
  await assert.rejects(
    lock.withLock('k', async () => {
      throw new Error('boom');
    }),
    /boom/
  );
  const r = await lock.withLock('k', async () => 'ok');
  assert.equal(r, 'ok');
});

test('redis path acquires NX PX, runs fn, releases via CAS Lua', async () => {
  const redis = new FakeRedis();
  const lock = new RoomLock(redis);
  const r = await lock.withLock('create', async () => {
    // lock should be held during fn
    const held = await redis.get('rooms:lock:create');
    assert.ok(held, 'lock value should be set during critical section');
    return 42;
  });
  assert.equal(r, 42);
  assert.equal(redis.evalCalls, 1);
  assert.equal(await redis.get('rooms:lock:create'), null);
});

test('redis CAS-delete refuses to delete a stolen lock', async () => {
  const redis = new FakeRedis();
  const lock = new RoomLock(redis);
  // Force the lock to expire mid-section by simulating another owner taking it.
  let stolen = false;
  const r = await lock.withLock('x', async () => {
    // simulate TTL expiry + new owner
    await redis.del('rooms:lock:x');
    await redis.set('rooms:lock:x', 'someone-else', 'NX', 'PX', 5000);
    stolen = true;
    return 'done';
  });
  assert.equal(r, 'done');
  assert.ok(stolen);
  // The new owner's value should still be present — CAS prevented stealing.
  assert.equal(await redis.get('rooms:lock:x'), 'someone-else');
});

test('redis path times out if lock never frees', async () => {
  const redis = new FakeRedis();
  // Pre-take the lock with a long TTL so the contender never gets it.
  await redis.set('rooms:lock:k', 'other', 'NX', 'PX', 60_000);
  const lock = new RoomLock(redis);
  await assert.rejects(
    lock.withLock('k', async () => 'never', { maxWaitMs: 50 }),
    LockTimeoutError
  );
});
