# Test Review Plan — geo-clash

This document divides the codebase into review parts. Each part is assigned to
an agent who **reviews the code and existing tests, then writes a test
implementation plan** — a prioritized list of tests that SHOULD be written.
**No test code is implemented in this phase.**

Each agent writes exactly one output file: `test-plans/<part-name>.md`
(see "Required output format" below).

---

## 1. Codebase map

### Live code vs. shims (important — verified via `server/src/index.js` imports)

The repo looks "duplicated" but is not. The live import graph is:

```
index.js ──> roomRegistry.js ──> clash/gameState.js, snake/gameState.js,
       │                       clash/socketHandlers.js, snake/socketHandlers.js,
       │                       shared/{memoryStore,valkeyStore,roomLock}.js
       ├──> socketHandlers.js ──> clash/socketHandlers.js,
       │                        snake/socketHandlers.js, shared/timeSync.js
       ├──> shared/memoryStore.js  (leaderboardStore)
       └──> tileProxy.js
```

**Top-level `server/src/*.js` are thin backward-compat re-export shims** —
do NOT plan tests for them:
- `server/src/gameState.js` (2 lines) → re-exports `clash/gameState.js`
- `server/src/projectiles.js` (5 lines) → re-exports `clash/projectiles.js`
- `server/src/gridUtils.js` (11 lines) → re-exports `shared/` + `clash/` grid utils
- `server/src/memoryStore.js` (13 lines) → re-exports `shared/memoryStore.js` + `shared/valkeyStore.js`
- `server/src/roomLock.js` (3 lines) → re-exports `shared/roomLock.js`
- `server/src/valkeyStore.js` (3 lines) → re-exports `shared/valkeyStore.js`

**Live top-level server files** (not shims): `index.js`, `socketHandlers.js`
(lobby/lifecycle dispatcher), `roomRegistry.js`, `tileProxy.js`.

Same pattern on the client: `client/src/clash/*.jsx`, `client/src/shared/*`
are 2-line re-export shims. Live client code is `App.jsx`, `socket.js`,
`hooks/*`, `components/*` (clash-mode UI), `snake/*`.

### Server inventory (~2,325 LOC) vs. existing tests

| File | LOC | Existing coverage | Status |
|---|---|---|---|
| `src/index.js` | 79 | none | UNTESTED — REST `/health`, `/api/rooms` GET/POST, `/api/leaderboard`, CORS parsing (not exported) |
| `src/socketHandlers.js` | 91 | none | UNTESTED — lobby events, join flow, gameType dispatch, disconnect→softDisconnect |
| `src/roomRegistry.js` | 321 | partial (`roomRegistry.test.js`, `cleanup.test.js`) | PARTIAL — create/join-capacity/destroy/gameType covered; softDisconnect, reconnect/swapSocketId, pending-disconnect timers, `_broadcastList`, `init()` UNTESTED |
| `src/tileProxy.js` | 104 | none | UNTESTED — `tileToBBox` math, metadata cache TTL, 404-on-old-imagery, proxy passthrough, 502 path; needs `fetch` mocking |
| `src/clash/gameState.js` | 579 | partial (`projectiles.test.js` 2 tests, `lateJoiner.test.js`, `cleanup.test.js` 2 tests) | PARTIAL — tick/capture, shields expiry, ammo, respawn, match timer, scores mostly UNTESTED |
| `src/clash/gridUtils.js` | 62 | none | UNTESTED — pure math: `buildGrid`, `cellIdAt`, `baseCellId` |
| `src/clash/projectiles.js` | 41 | good (`projectiles.test.js` 3 pure-fn tests) | COVERED — remaining gaps: `AUTO_AIM_CONE_DEG`, range clamp, heading-vs-target precedence |
| `src/clash/socketHandlers.js` | 21 | none | UNTESTED (thin) — input validation + delegation |
| `src/snake/gameState.js` | 414 | partial (eat, foodCap, headOnHead, lastAlive, tailTrim tests) | PARTIAL — snapshot, `_spawnPoint`, removePlayer/cancelClashes, clash timeout, respawn, food respawn timer UNTESTED |
| `src/snake/collisions.js` | 60 | partial (`collide.test.js`, `headOnHead.test.js`) | PARTIAL — `collidesWithTail` unit covered; `resolveCollisions` paths partially via gameState tests |
| `src/snake/food.js` | 34 | good (`food.test.js`) | COVERED |
| `src/snake/constants.js` | 53 | n/a | constants only — no tests needed |
| `src/snake/socketHandlers.js` | 25 | none | UNTESTED (thin) — validation of foodId/clashId/lat/lng |
| `src/shared/gridUtils.js` | 37 | none | UNTESTED — pure math: `distanceMeters`, `bboxAround`, `metersToDeg{Lat,Lng}` |
| `src/shared/memoryStore.js` | 184 | partial (`memoryStore.test.js`, `leaderboard.test.js`) | PARTIAL — MemoryStore/MemoryLeaderboardStore covered; `ValkeyLeaderboardStore`, `redisClient`/env branching, `makeRoomStores` Redis path UNTESTED |
| `src/shared/roomLock.js` | 77 | good (`roomLock.test.js`, 5 tests) | COVERED — verify option paths (`ttlMs`, `maxWaitMs`) only |
| `src/shared/timeSync.js` | 13 | none | UNTESTED (tiny) — ack vs emit path |
| `src/shared/valkeyStore.js` | 93 | partial (`valkeyZSet.test.js`, 3 tests) | PARTIAL — `ValkeyZSetStore` covered; `ValkeyStore` (get/set/del/has/keys/all/clear/size) UNTESTED |

Existing test files (15): `server/test/{memoryStore,roomLock,roomRegistry,
projectiles,cleanup,lateJoiner,leaderboard,valkeyZSet}.test.js` and
`server/test/snake/{collide,eat,food,foodCap,headOnHead,lastAlive,tailTrim}.test.js`.

### Client inventory (~2,845 LOC live) vs. existing tests

No test runner, no tests. Live files:

| File | LOC | Notes |
|---|---|---|
| `src/socket.js` | 41 | `getSessionId` (sessionStorage), `SERVER_URL`/`API_BASE` env derivation, `getSocket` singleton |
| `src/hooks/useGeolocation.js` | 53 | `bearing()` fallback math, simulated-position override, watch cleanup |
| `src/hooks/useRooms.js` | 35 | `rooms-updated` subscription, `rooms-list` ack refresh |
| `src/hooks/useSound.js` | 170 | WebAudio — low value to test, skip or P2 |
| `src/App.jsx` | 154 | lobby→game screen switching by `gameType` |
| `src/components/GameScreen.jsx` | 508 | clash screen — mostly socket wiring + render |
| `src/components/LobbyScreen.jsx` | 492 | room create/join forms — validation logic |
| `src/components/MapView.jsx` | 232 | Leaflet wrapper — skip (needs DOM/tiles) |
| `src/components/{ControlPanel,HUD,PostMatchScreen,ProjectileLayer,SimPanel}.jsx` | ~480 | HUD/PostMatch may hold small pure logic (score sorting, timer formatting) |
| `src/snake/{GameScreen,HUD,SnakeLayer,FoodLayer}.jsx` | ~593 | mostly render/socket glue |

Shims (skip): `client/src/clash/*.jsx`, `client/src/shared/*`.

---

## 2. Work split decision

**Split into 4 parts.** The two game modes are cleanly separated on the server
and each has a large state module (~580 / ~415 LOC) with a tick loop — each
deserves a dedicated reviewer. Server infrastructure (registry, dispatcher,
stores, tile proxy, entrypoint) is a third coherent chunk. The client is a
fourth part with deliberately reduced scope (no runner exists yet).

| Part | Output file | Scope |
|---|---|---|
| A — server-core-infra | `test-plans/server-core-infra.md` | `server/src/{index,socketHandlers,roomRegistry,tileProxy}.js` + `server/src/shared/*.js` |
| B — clash-game | `test-plans/clash-game.md` | `server/src/clash/*.js` |
| C — snake-game | `test-plans/snake-game.md` | `server/src/snake/*.js` |
| D — client | `test-plans/client.md` | `client/src` live files only |

File lists below are exhaustive — agents must not review files outside their
part (prevents overlap).

---

## 3. Per-part instructions

### Part A — server-core-infra → `test-plans/server-core-infra.md`

**Files in scope (all under `server/src/`):**
- `index.js`
- `socketHandlers.js` (top-level dispatcher — NOT the per-game ones)
- `roomRegistry.js`
- `tileProxy.js`
- `shared/gridUtils.js`
- `shared/memoryStore.js`
- `shared/valkeyStore.js`
- `shared/roomLock.js`
- `shared/timeSync.js`
- Re-export shims (`gameState.js`, `projectiles.js`, `gridUtils.js`,
  `memoryStore.js`, `roomLock.js`, `valkeyStore.js` at `src/` root): confirm
  they are shims, note that they need no tests, do not plan tests for them.

**Existing tests to account for (read them first):**
`test/roomRegistry.test.js`, `test/cleanup.test.js`, `test/memoryStore.test.js`,
`test/leaderboard.test.js`, `test/roomLock.test.js`, `test/valkeyZSet.test.js`.

**Critical behaviors to evaluate:**
- `roomRegistry.js`: `init()` rehydration; `join()` reconnect path
  (`sessionId` → `getPlayerBySessionId`/`swapSocketId`, `reconnected: true`,
  cancelling pending-disconnect timers); `softDisconnect()` grace period and
  what fires on expiry; `leave()` while a disconnect is pending; `destroy()`
  while timers pending; `_broadcastList()` payload (`rooms-updated`); room
  metadata shape returned by `list()`.
- `socketHandlers.js`: on `connection` → `rooms-updated` emit; `rooms-list`
  ack; `room-create` ack ok/fail + payload validation/defaults (`gameType`,
  `timeLimitMs`, `maxAmmo`); `room-join` full flow — missing `roomId` ack,
  `ensureGridFromPlayer` call, `snapshot` emit, `joined` emit,
  `player-joined` room broadcast, correct game handler registration by
  `socket.data.gameType`; `room-leave`; `disconnect` → `registry.softDisconnect`;
  `time-sync` ack vs emit fallback.
- `index.js`: REST endpoints — `/health`, `GET /api/rooms`, `POST /api/rooms`
  (201 + error→500), `GET /api/leaderboard` (`limit` clamping 1–100, default 25,
  `gameType` pass-through); `parseCorsOrigin` logic (note: not exported — plan
  may recommend a tiny refactor to export it, or test via HTTP). For HTTP-level
  tests, prefer binding the express app to an ephemeral port; note that
  `index.js` is an entrypoint that auto-listens, so planning may require
  suggesting a small extract-app refactor — flag this explicitly.
- `tileProxy.js`: `tileToBBox` correctness (known z/x/y → bbox); metadata cache
  hit/miss/TTL; imagery older than `maxAge` → 404; missing metadata → proxy
  through; upstream non-OK → same status; upstream throw → 502;
  `maxAge` query parsing. Needs `globalThis.fetch` stubbing.
- `shared/gridUtils.js`: `distanceMeters` known-distance checks + same-point=0;
  `metersToDegLng` latitude dependence; `bboxAround` symmetry/size.
- `shared/memoryStore.js`: `ValkeyLeaderboardStore` with a fake ioredis client
  (mirror `valkeyZSet.test.js`'s `FakeZRedis` approach); `makeRoomStores` /
  `redisClient` behavior when `REDIS_URL`/`VALKEY_URL` env is set vs unset
  (check the env-var logic in the file first).
- `shared/valkeyStore.js`: `ValkeyStore` KV ops with a fake client — get/set
  JSON round-trip, del, has, keys (prefix stripping), all, clear, size.
- `shared/timeSync.js`: ack path vs `socket.emit` fallback.
- `shared/roomLock.js`: verify all branches covered by existing tests; only
  plan tests for uncovered option paths.

### Part B — clash-game → `test-plans/clash-game.md`

**Files in scope:**
- `server/src/clash/gameState.js` (579 LOC — the bulk of the work)
- `server/src/clash/gridUtils.js`
- `server/src/clash/projectiles.js`
- `server/src/clash/socketHandlers.js`

**Existing tests to account for (read them first):**
`test/projectiles.test.js`, `test/lateJoiner.test.js`, `test/cleanup.test.js`.

**Critical behaviors to evaluate:**
- Grid lifecycle: `initGrid`, `ensureGridFromPlayer` (first player seeds bbox);
  `buildGrid`/`cellIdAt`/`baseCellId` math in `gridUtils.js` — cell counts,
  boundary coords returning `null` (lat/lng on north/east edge), center base cell.
- The authoritative **tick** (`tick()`): capture progress accrual while a
  player stands in a cell, ownership flip thresholds, contested cells
  (two players same cell), `grid-update` diff emissions vs full snapshot,
  scoring/`_recountScores`, time-limit expiry → `match-end`.
- Combat: `attack()` — heading-only vs explicit `target`, `AUTO_AIM_CONE_DEG`
  target selection, `ATTACK_RANGE_M` clamping, ammo (`maxAmmo`,
  `_scheduleAmmoRecharge`, `ammoRenewalMs`) — decrement, block at 0, recharge;
  `_resolveProjectile` hit/miss at `tArrival` (partially covered — extend);
  `activateShield` — expiry, blocking, cooldown if any.
- Players: `addPlayer`/`removePlayer`, `getPlayerBySessionId`,
  `swapSocketId` (reconnect), `respawn` (position reset to base center, state
  reset, event emitted), `updateLocation` bounds handling.
- `snapshot()` completeness for late joiners (cells, players, projectiles,
  scores, timer).
- `socketHandlers.js`: non-number lat/lng ignored; events delegate to the
  right game methods with `socket.id`.

### Part C — snake-game → `test-plans/snake-game.md`

**Files in scope:**
- `server/src/snake/gameState.js` (414 LOC)
- `server/src/snake/collisions.js`
- `server/src/snake/food.js`
- `server/src/snake/constants.js` (constants only — likely nothing to test; verify)
- `server/src/snake/socketHandlers.js`

**Existing tests to account for (read them first):**
`test/snake/{collide,eat,food,foodCap,headOnHead,lastAlive,tailTrim}.test.js`.

**Critical behaviors to evaluate:**
- `updateLocation`: storing/relaying client-owned `tailPoints` + `score`;
  `MIN_MOVE_M` deduplication if present.
- `eatFood`: invalid/unknown `foodId` ignored, idempotent double-eat, score
  increment + `snake-ate` emission (partially covered via tick-path test).
- Clash resolution: `resolveCollisions` paths — head-on-head vs head-on-tail,
  `SPAWN_GRACE_MS` immunity, `clash_verify` → `clashAck` → commit/`snake-hit`,
  **clash timeout** when ACKs never arrive (only the absent-killer case is
  tested), `cancelClashesFor` on disconnect, `_killPlayer` consequences
  (score transfer? respawn? event payload).
- Lifecycle: `startMatch` emissions + initial food spawn, `_spawnPoint`
  (inside arena bbox), `removePlayer` mid-clash, `endMatch` → leaderboard
  archive (compare with clash `endMatch`), last-alive rule (covered) vs
  timer expiry.
- `snapshot()` shape for late joiners (foods, players, tails, scores).
- Food respawn interval timer (`foodRespawnIntervalMs`) — note tests inject
  huge intervals; plan should cover the interval-driven replenish path.
- `socketHandlers.js`: `foodId`/`clashId` non-string rejection, lat/lng
  numeric validation.

### Part D — client → `test-plans/client.md`

**Files in scope (live files only — skip all 2-line shims):**
- `client/src/socket.js`
- `client/src/hooks/useGeolocation.js`
- `client/src/hooks/useRooms.js`
- `client/src/hooks/useSound.js` (evaluate; likely skip — WebAudio)
- `client/src/App.jsx`
- `client/src/components/LobbyScreen.jsx` (form validation)
- `client/src/components/{GameScreen,HUD,PostMatchScreen,ControlPanel,ProjectileLayer,SimPanel,MapView}.jsx` (evaluate for any pure/derived logic worth testing; MapView is Leaflet-bound — expect skip)
- `client/src/snake/{GameScreen,HUD,SnakeLayer,FoodLayer}.jsx`
- Skip: `client/src/clash/*.jsx`, `client/src/shared/*` (re-export shims), `main.jsx`.

**Setup note (must be in the output plan):** the client has no test runner.
The plan should specify what's needed — `vitest` + `@testing-library/react` +
`@testing-library/react-hooks` (or `renderHook` from RTL ≥13.1) + `jsdom` +
`vite.config.js` test section — and mock `socket.io-client` for `socket.js`/
`useRooms`. **Keep client scope minimal and realistic:** prioritize pure
functions and hooks (`getSessionId` sessionStorage persistence, `API_BASE`
derivation, `bearing()` fallback math, `useRooms` subscription behavior,
LobbyScreen validation). Component render tests should be few and P2 —
this is an MVP web app; don't plan exhaustive component coverage.

---

## 4. Required output format (all parts)

Each agent writes `test-plans/<part-name>.md` containing:

1. **Header**: part name, files reviewed, existing tests accounted for.
2. **Coverage gaps summary**: 3–8 bullets on the riskiest untested behavior.
3. **Prioritized test list** — a Markdown table or list where every proposed
   test has ALL of these fields:
   - **Test name/description** — as it would appear in `test('...')`
   - **File under test** — e.g. `server/src/clash/gameState.js`
   - **Proposed test file** — e.g. `server/test/clash/capture.test.js`
     (mirror the existing `test/snake/` subfolder convention for mode-specific
     tests)
   - **Test type** — `unit` | `integration` | `socket-level`
   - **Scenario + edge cases** — arrange/act/assert in one or two sentences,
     plus boundary cases
   - **Mocking/setup needs** — e.g. io stub (`makeIoStub` pattern), fake
     socket (`{id, data:{}, join(){}, leave(){}}`), fake ioredis client,
     stubbed `globalThis.fetch`, direct `game._tick()` calls (existing tests
     drive ticks manually rather than using fake timers), `t.after()` cleanup
     for `endMatch`/`destroy`
   - **Priority** — `P0` (authoritative game rules / data loss / security),
     `P1` (important behavior, error paths), `P2` (nice-to-have, UI)
4. **Refactor-for-testability notes** (optional, short): e.g. exporting
   `parseCorsOrigin` from `index.js` or splitting the express app from
   `server.listen`.

---

## 5. Constraints & conventions

- **Server tests use `node --test`** (`npm test` in `server/`). Match the
  existing style exactly:
  - `import test from 'node:test';` + `import assert from 'node:assert/strict';`
  - Plain async test functions; `t.after(...)` for cleanup (e.g. `game.endMatch()`,
    `reg.destroy(id)`) so intervals don't leak between tests.
  - io stub pattern: object with `_events` array, `to(id) → {emit}`,
    `in(id) → {fetchSockets}`, `emit` — see `test/roomRegistry.test.js` and
    `test/cleanup.test.js`.
  - Fake socket: `{ id, data: {}, join() {}, leave() {} }`.
  - Fake Redis clients implement only the ioredis methods under test — see
    `FakeZRedis` in `test/valkeyZSet.test.js`.
  - Tick loops are driven by calling `game._tick()` / `game.tick()` directly —
    **no fake-timer library** is used; tests inject long intervals
    (e.g. `foodRespawnIntervalMs: 999_999`) to keep timers inert and clean up
    with `t.after`.
  - Tests freely set private fields (`game._bbox`, `game._foods`) to arrange
    state — this is an accepted convention here.
- **Do not plan tests that need a real Redis/Valkey** — always fake the client.
- **Do not plan tests for re-export shim files** (server `src/*.js` shims,
  client `clash/*.jsx`, `client/src/shared/*`, `snake/constants.js`).
- **Client**: no runner exists; plan the vitest+RTL+jsdom setup but keep the
  proposed suite small (hooks/pure-logic first, components last and few).
- **Plans only.** Agents must not write `*.test.js` files or modify source
  code. Suggested refactors go in the plan's refactor-notes section.
- Each agent should read the existing tests relevant to its part before
  proposing anything, and must not re-propose already-covered scenarios.
