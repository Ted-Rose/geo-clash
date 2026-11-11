# Design

## Context

The entire point of the KV facade (`shared/memoryStore.js`) is
backend transparency: `makeRoomStores` picks `ValkeyStore` when
`VALKEY_URL` is set and `MemoryStore` otherwise, and call sites
`await` every method so the swap is a non-event. Two impl details
break that transparency today. The `server-core-infra` test plan
described both as possibly-intentional quirks ("ioredis flattens
array args so both work in prod"; "`size()` hardcoded 0 avoids
KEYS cost") — this change revises both calls deliberately, on
contract-parity grounds.

## Goals / Non-Goals

**Goals:**
- `await store.clear()` empties the prefixed keyspace under both
  impls, with no reliance on ioredis argument-flattening.
- `await store.size()` returns the live entry count under both
  impls.

**Non-Goals:**
- No `SCAN`-based `keys()` rework — `KEYS` is already used by
  `keys()`/`all()`/`clear()` at MVP scale; that is a separate
  performance change.
- No `ValkeyLeaderboardStore` or `ValkeyZSetStore` changes —
  both already conform.
- No new call sites for `size()` — this restores contract parity;
  nothing currently consumes it in `src/`.

## Decisions

- **Spread keys in `clear()`.** `del(...ks.map(k => this._k(k)))`
  matches `ValkeyLeaderboardStore.clear()`
  (`memoryStore.js` ~line 147) and the strict variadic ioredis
  signature. Alternative: keep the array form and rely on ioredis
  flattening — rejected: it works only by accident of one client's
  argument coercion, is inconsistent with the sibling impl in the
  same codebase, and fails silently rather than loudly.
- **`size()` returns `(await this.keys()).length`, declared
  `async`.** `await store.size()` resolves to a real count on
  Valkey and still works on `MemoryStore` (awaiting a number is
  a no-op), preserving the "call sites never branch on backend"
  rule. A dedicated count command would save nothing — `clear()`
  already runs the same `keys()` scan.
- **`FakeKvRedis` stays array-tolerant.** The test fake tolerating
  both `del` call shapes remains valid (ioredis itself does);
  the source fix makes the array path unreachable rather than
  banning it in the fake.

## Risks / Trade-offs

- [A caller somewhere depends on `size() === 0`] → none exists:
  `size()` has zero call sites outside the test files (verified
  by grep).
- [`keys()` inside `size()` is O(keyspace)] → identical cost class
  to the existing `all()`/`clear()`; acceptable at MVP room sizes.
- [The pinning test is inverted, masking a regression in the
  flattening behavior] → the updated test asserts behavior
  (prefix drained, count correct), not call shape.
