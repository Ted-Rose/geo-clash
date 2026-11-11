# Proposal

## Why

`ValkeyStore` (`server/src/shared/valkeyStore.js`) is the
Redis/Valkey-backed drop-in for `MemoryStore`, but two methods
violate the shared contract:

- `clear()` calls `this._client.del(ks.map(k => this._k(k)))` —
  passing one array argument instead of spreading the keys. The
  sibling `ValkeyLeaderboardStore.clear()` already uses the spread
  form (`del(...keys)`); under a strict variadic `del` the array
  form silently deletes nothing, so room teardown leaves stale
  `room:<roomId>:*` keys behind — exactly what per-room key
  isolation exists to prevent.
- `size()` is hardcoded `return 0`, where `MemoryStore.size()`
  returns the real entry count. Any call site relying on `size()`
  (diagnostics, capacity checks) silently misbehaves the moment
  `VALKEY_URL` is set — a backend swap that is supposed to be
  invisible to callers.

Both were flagged in the `server-core-infra` test plan review and
are now pinned as bugs by the new `valkeyStore.test.js` suite.

## What Changes

- **server:** `clear()` spreads the prefixed keys
  (`del(...keys)`), matching `ValkeyLeaderboardStore`; `size()`
  becomes an async method returning the count of prefixed keys,
  so `await store.size()` reports identically on both impls.
- **server tests:** update `test/valkeyStore.test.js` — the V3
  case's `size() === 0` quirk assertion and test name are
  inverted to assert the real count; keep `FakeKvRedis`
  array-tolerant `del` (it still exercises the fixed call).

No socket events, payload shapes, or client code change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memory-store` — "Async-friendly KV surface" gains `size` in
  the required method set, and the contract now explicitly
  requires `clear()` to drain the backend under either impl.

## Impact

- `server/src/shared/valkeyStore.js`: two method bodies (~4
  lines).
- `server/test/valkeyStore.test.js`: one test updated/renamed;
  no new fakes needed (`FakeKvRedis` already covers `keys` +
  variadic `del`).
- Verified by `npm --prefix server test`.
