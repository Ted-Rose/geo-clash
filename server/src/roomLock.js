// Distributed-lock-aware mutex used for room create/join critical sections.
// In dev (no redis client) falls back to an in-process Map<key, Promise> mutex
// so the API contract is preserved without an external dependency.

import { randomUUID } from 'crypto';

export class LockTimeoutError extends Error {
  constructor(key) {
    super(`lock timeout: ${key}`);
    this.name = 'LockTimeoutError';
  }
}

const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

export class RoomLock {
  constructor(redis) {
    this._redis = redis || null;
    this._local = new Map(); // key -> Promise (chain tail)
  }

  async withLock(key, fn, { ttlMs = 2000, maxWaitMs = 1000 } = {}) {
    if (!this._redis) return this._withLocalLock(key, fn);
    const lockKey = `rooms:lock:${key}`;
    const token = randomUUID();
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const ok = await this._redis.set(lockKey, token, 'NX', 'PX', ttlMs);
      if (ok === 'OK') {
        try {
          return await fn();
        } finally {
          await this._releaseIfOwner(lockKey, token);
        }
      }
      const wait = 5 + Math.random() * 15;
      await new Promise((r) => setTimeout(r, wait));
    }
    throw new LockTimeoutError(key);
  }

  async _releaseIfOwner(lockKey, token) {
    try {
      await this._redis.eval(RELEASE_LUA, 1, lockKey, token);
    } catch (err) {
      // best-effort; log and move on so the lock TTL eventually drains
      // eslint-disable-next-line no-console
      console.error('[roomLock] release failed:', err.message);
    }
  }

  async _withLocalLock(key, fn) {
    while (this._local.has(key)) {
      try {
        await this._local.get(key);
      } catch {
        // previous holder threw; ignore — we just waited our turn
      }
    }
    let release;
    const p = new Promise((r) => {
      release = r;
    });
    this._local.set(key, p);
    try {
      return await fn();
    } finally {
      this._local.delete(key);
      release();
    }
  }
}
