// Bootstrap test: when VALKEY_URL is set, memoryStore.js must select the
// Valkey-backed stores. Uses a query-suffixed dynamic import to bypass the
// ESM module cache; the bogus URL means ioredis connects to nothing — the
// module's own 'error' listener keeps that non-fatal.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ValkeyStore } from '../src/shared/valkeyStore.js';

test('VALKEY_URL set selects Valkey stores', async (t) => {
  const prev = process.env.VALKEY_URL;
  process.env.VALKEY_URL = 'rediss://127.0.0.1:6390';

  const mod = await import(`../src/shared/memoryStore.js?case=valkey-${Date.now()}`);

  t.after(async () => {
    if (prev === undefined) delete process.env.VALKEY_URL;
    else process.env.VALKEY_URL = prev;
    if (mod.redisClient) await mod.redisClient.disconnect();
  });

  assert.ok(mod.redisClient, 'redisClient constructed when VALKEY_URL set');

  const stores = mod.makeRoomStores('room-x');
  assert.ok(stores.playerStore instanceof ValkeyStore, 'playerStore is Valkey');
  assert.ok(stores.gridStore instanceof ValkeyStore, 'gridStore is Valkey');
  assert.ok(stores.projectileStore instanceof ValkeyStore, 'projectileStore is Valkey');

  assert.equal(
    mod.leaderboardStore.constructor.name,
    'ValkeyLeaderboardStore',
    'leaderboard switches to the Valkey impl'
  );
});
