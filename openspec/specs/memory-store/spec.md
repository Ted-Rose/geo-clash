# Memory Store Specification

## Purpose

Defines the async KV facade (`server/src/shared/memoryStore.js`) that
backs every persistent collection. The contract exists so the default
in-process `Map` impl can be swapped for Redis/Valkey without changing
call sites — no database or ORM is permitted for the MVP.

## Requirements

### Requirement: Async-friendly KV surface

Stores SHALL expose `get`, `set`, `del`, `has`, `keys`, `all`, and
`clear` as awaitable methods, and consumers MUST `await` every call —
even though the `MemoryStore` impl resolves synchronously. Business
logic MUST NOT use a bare `Map` for persistent collections.

#### Scenario: Call site survives a backend swap

- **WHEN** a code path reads `await store.get(key)`
- **THEN** it behaves identically whether the impl is `MemoryStore` or
  `ValkeyStore`

### Requirement: Env-selected backend

`makeRoomStores(roomId)` SHALL return `ValkeyStore` instances
(key-prefixed `room:<roomId>:<collection>`) when `VALKEY_URL` is set,
and `MemoryStore` instances otherwise. Selection happens once at
bootstrap; call sites never branch on the backend.

#### Scenario: Room stores minted per backend

- **WHEN** a room is created with `VALKEY_URL` configured
- **THEN** its `playerStore`, `gridStore`, and `projectileStore` are
  `ValkeyStore`s sharing the `room:<roomId>:` prefix

### Requirement: Per-room key isolation

All runtime keys for a room SHALL live under `room:<roomId>:*` (or in
disposable in-memory stores) so a single `clear()` per collection
drains the room — teardown never touches another room's keys.

#### Scenario: Room teardown purges only itself

- **WHEN** `endMatch` clears a room's stores
- **THEN** only that room's keys are deleted; sibling rooms are
  untouched

### Requirement: Capped leaderboard

`leaderboardStore.archive` SHALL record a match result keyed by
member `${playerId}:${matchId}` carrying `score`, `metric`, `gameType`,
and metadata. The 10 000-entry cap covers the memory impl's list and,
under Valkey, only the per-`gameType` zset (`leaderboard:<gameType>`) —
the shared `leaderboard:all` zset is never trimmed. `top(limit,
{ gameType })` SHALL return highest scores first, optionally filtered
by `gameType`. `squaresCaptured` is a deprecated alias for `score`.

#### Scenario: Leaderboard caps at 10k

- **WHEN** an archive call would push a capped collection (the memory
  list or a per-`gameType` zset) past 10 000 entries
- **THEN** the lowest-scored entries are dropped and ordering stays
  desc-by-score
