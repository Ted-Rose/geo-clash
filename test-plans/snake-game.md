# Test Implementation Plan — Part C: snake-game

**Files reviewed (in scope):**
- `server/src/snake/gameState.js` (414 LOC — `SnakeGameState`)
- `server/src/snake/collisions.js` (60 LOC — `collidesWithTail`, `resolveCollisions`)
- `server/src/snake/food.js` (34 LOC — `spawnFood`, `isEaten`, `replenishFood`)
- `server/src/snake/constants.js` (53 LOC — constants only, no tests needed; verified)
- `server/src/snake/socketHandlers.js` (25 LOC — `registerSnakeHandlers`)

**Existing tests accounted for:**
`test/snake/{collide,eat,food,foodCap,headOnHead,lastAlive,tailTrim}.test.js` — all read.

## Stale / misleading existing tests (verified by running `node --test`)

These matter more than new coverage — the suite currently misleads:

| Existing test | Status | Why |
|---|---|---|
| `eat.test.js` — "player scores when walking over food" | **FAILS** | Asserts the *old* server-side proximity-eat model (`updateLocation` + `_tick` → `snake-ate`). Eating is now client-reported via `eat_food` → `game.eatFood()`; `_tick` never inspects food proximity. Score stays 0. **Rewrite to call `eatFood()` directly (see P0 cases below) or delete.** |
| `lastAlive.test.js` — "last player alive triggers match-end" | **FAILS + HANGS THE SUITE** | No last-alive rule exists in `gameState.js` anymore — `_tick` only ends on `timeLimitMs`. Worse, the test has **no `t.after` cleanup**, so the live tick interval keeps the event loop alive and `node --test test/snake/` never exits. **Delete or re-scope (decision needed on whether last-alive was intentionally removed).** |
| `tailTrim.test.js` — both tests | **PASSES VACUOUSLY** | `updateLocation` no longer appends/trims tail segments server-side (client-authoritative tail). `p.tailPoints` stays `[]`, so "path length ≤ cap" and "empty at score 0" are trivially true. **Delete or repurpose as real `updateLocation` tests (below).** |
| `headOnHead.test.js` | passes | Covers clash_verify emission, both-ack → snake-hit, killer-silent → no kill. Does NOT cover: timeout expiry, cancel-on-disconnect, kill state consequences, dedup, ack ordering. |
| `collide.test.js`, `food.test.js`, `foodCap.test.js` | pass | `collidesWithTail` basics, `food.js` pure fns, replenish cap — adequately covered. |

## Coverage gaps summary (riskiest untested behavior)

- **`eatFood()` is effectively untested** — first claim vs race-window double-award, the deliberate unconditional award for unknown `foodId`, `_recentlyEaten` purge, and the `!matchActive`/unknown-player no-ops. This is the scoring path — P0.
- **Clash handshake end-state is untested** — only "killer didn't ack → no kill yet" is covered. Missing: `CLASH_ACK_TIMEOUT_MS` expiry in `_tick`, `cancelClashesFor`/`removePlayer` mid-clash, ack ordering (killer first), unknown `clashId`, double-ack idempotency, and the `alreadyPending` one-clash-per-victim dedup.
- **`_killPlayer` consequences are unasserted** — victim score→0 / `tailPoints`→[] / `spawnedAt` refresh (respawn grace), killer `kills+1` / `score+5`, `snake-hit` room broadcast, `snake-reset` targeted at victim only, `killerId: null` variant.
- **Match lifecycle is untested** — `startMatch` payload + idempotency + restart-block after end, `endMatch` leaderboard archive (`gameType:'snake'`, `metric:'kills'`), playerStore purge, `_onEnd` callback, interval teardown, time-limit expiry path in `_tick`.
- **`resolveCollisions` unit paths** — spawn-grace excludes a player as *both* victim and killer, head-on-tail priority over head-on-head (`break`), own-tail immunity, `alive:false` exclusion, `<= COLLISION_RADIUS_M` boundary, `inGrace` mutation persistence.
- **`updateLocation` / `snapshot()` / `socketHandlers`** — client-supplied `tailPoints`/`score` stored verbatim (and ignored when wrong type), lazy `_initArena` on first location, snapshot shape for late joiners, and all three socket validators — none exercised.
- **Food respawn interval** — the `setInterval` replenish + conditional `food-update` emit is untested (existing tests inject `999_999` to keep it inert).
- **Test-pollution hazard:** `endMatch()` archives into the module-level `leaderboardStore` singleton — new tests must isolate it (stub `leaderboardStore.archive` or `await leaderboardStore.clear()` in `t.after`) or leaderboard tests will cross-contaminate.

## Conventions / setup needs (shared)

- `node --test` + `node:assert/strict`; plain async tests; `t.after(() => game.endMatch())` for cleanup.
- io stub: `{ _events: [], to: (id) => ({ emit: (e,p) => _events.push({target:id,event:e,payload:p}) }), emit: (e,p) => _events.push({event:e,payload:p}) }` (the `target`-capturing variant from `headOnHead.test.js` — needed to verify per-socket events like `snake-reset`/`clash_verify`).
- No fake-timer library: drive `game._tick()` directly; seed `_pendingClashes`, `_recentlyEaten`, `_foods`, `_bbox`, `playerStore` entries directly (accepted convention). For the one interval-driven test, use a short real `foodRespawnIntervalMs` (e.g. 20 ms) + `await new Promise(r => setTimeout(r, ~80))`.
- Fake socket for handler tests: `{ id, data: {}, _handlers: {}, on(ev, fn) { this._handlers[ev] = fn; }, join() {}, leave() {} }` + a recorder `game` stub (`{ updateLocation: rec('updateLocation'), eatFood: rec('eatFood'), clashAck: rec('clashAck') }`) — asserts delegation without a real `SnakeGameState`.
- Deterministic RNG is NOT required: `_spawnPoint`/food tests assert bounds, not exact values.
- Spawn-grace setup: write players with `spawnedAt = Date.now() - SPAWN_GRACE_MS - 100` directly into `playerStore` (as `headOnHead.test.js` does).
- `leaderboardStore` is a shared singleton — stub `archive` or `clear()` in `t.after` for any `endMatch` test.

## Prioritized test list

### P0 — authoritative rules / scoring / kill-commit / data loss

| # | Test name | File under test | Proposed test file | Type | Scenario + edge cases | Setup needs |
|---|---|---|---|---|---|---|
| 1 | `eatFood: first claim removes food, awards point, emits snake-ate + food-update` | gameState.js | `test/snake/eatFood.test.js` | integration | Arrange live `_foods` with `food1`; call `eatFood('p1','food1')`; assert `food1` gone, `p.score === FOOD_SCORE_PER_ITEM`, `snake-ate` payload `{playerId, foodId, score}`, `food-update` emitted. | io stub w/ `_events`; `startMatch()`; `t.after(endMatch)` |
| 2 | `eatFood: second player reporting same foodId inside EAT_RACE_WINDOW_MS still scores (double-award tolerated)` | gameState.js | `test/snake/eatFood.test.js` | integration | p1 eats `food1` → removed; p2 calls `eatFood('p2','food1')` → p2 also `+1`, food list unchanged (already removed), second `snake-ate` emitted. Documents intended race tolerance. | same |
| 3 | `eatFood: unknown foodId never seen still awards point (unconditional award)` | gameState.js | `test/snake/eatFood.test.js` | integration | `eatFood('p1','never-existed')` → `p.score +1`. Asserts the deliberately permissive contract so a future "fix" is a conscious change. | same |
| 4 | `eatFood: no-op when match not active / unknown player` | gameState.js | `test/snake/eatFood.test.js` | integration | Call before `startMatch()` → no score, no events; call with `'ghost'` after start → no events, no throw. | same |
| 5 | `eatFood: stale _recentlyEaten entries (> EAT_RACE_WINDOW_MS) are purged` | gameState.js | `test/snake/eatFood.test.js` | unit | Seed `_recentlyEaten` with `old → Date.now()-4000`; call `eatFood` on a live food; assert `old` deleted from map. | seed private field |
| 6 | `clashAck: unknown clashId is a no-op` | gameState.js | `test/snake/clashHandshake.test.js` | unit | `clashAck('p1','bogus')` → no throw, no `snake-hit`, `_pendingClashes` unchanged. | io stub |
| 7 | `clashAck: ignored when match not active` | gameState.js | `test/snake/clashHandshake.test.js` | unit | Seed `_pendingClashes` with a complete-entry, never `startMatch()`; ack → no kill. | seed private field |
| 8 | `clashAck: killer ACKs first → kill still waits for victim ACK` | gameState.js | `test/snake/clashHandshake.test.js` | integration | Head-on-tail setup → `clash_verify`; `clashAck(killerId)` → no `snake-hit`; then `clashAck(victimId)` → `snake-hit`. Complements existing victim-first coverage. | spawnedAt-in-past players; `to(id)`-capturing io |
| 9 | `clashAck: duplicate ACK from same socket is idempotent` | gameState.js | `test/snake/clashHandshake.test.js` | unit | After first `clashAck(victim)`, second `clashAck(victim, sameId)` → still pending, no `snake-hit` (Set.delete). | same |
| 10 | `_tick: pending clash older than CLASH_ACK_TIMEOUT_MS expires → removed, no snake-hit` | gameState.js | `test/snake/clashHandshake.test.js` | integration | Seed `_pendingClashes` with `timestamp: Date.now() - CLASH_ACK_TIMEOUT_MS - 1`; `_tick()` → entry gone, no `snake-hit`, and a *fresh* collision afterwards can raise a new `clash_verify`. | seed private field; manual `_tick()` |
| 11 | `removePlayer / cancelClashesFor: pending clash involving the leaver is cancelled` | gameState.js | `test/snake/clashHandshake.test.js` | integration | Pending clash where `p2` is in `acksNeeded`; `removePlayer('p2')` → clash deleted; `clashAck(p1)` → no `snake-hit`; `playerStore.get('p2')` → undefined. Covers disconnect path (registry calls `removePlayer` on leave). | same |
| 12 | `_tick: at most one pending clash per victim (alreadyPending dedup)` | gameState.js | `test/snake/clashHandshake.test.js` | integration | Head-on-head produces duplicate kill entries for the same victim across outer-loop iterations; assert exactly **one** `clash_verify` targeted at each victim and `_pendingClashes.size === 2` (not 4). | `to(id)`-capturing io; count `verify.target` |
| 13 | `_killPlayer: victim reset (score→0, tailPoints→[], spawnedAt refreshed, alive stays true)` | gameState.js | `test/snake/killPlayer.test.js` | unit | Set victim score 9 + tailPoints; `_killPlayer('v','k')`; assert resets and `spawnedAt ≈ now` (re-enters spawn grace). | direct private call |
| 14 | `_killPlayer: killer credited kills+1 and score+5` | gameState.js | `test/snake/killPlayer.test.js` | unit | Killer with score 3/kills 0 → kills 1, score 8. | same |
| 15 | `_killPlayer: emits snake-hit to room and snake-reset only to victim socket` | gameState.js | `test/snake/killPlayer.test.js` | unit | Assert `snake-hit` payload `{victimId, killerId}` is room-scoped; `snake-reset` `{spawnedAt}` has `target === victimId` and is NOT sent to killer. | `to(id)`-capturing io |
| 16 | `_killPlayer: killerId null (head-on-head) → no killer lookup, snake-hit killerId null` | gameState.js | `test/snake/killPlayer.test.js` | unit | `_killPlayer('v', null)` → victim reset, no score bump anywhere, payload `killerId: null`. | same |
| 17 | `endMatch: archives every player to leaderboard (gameType 'snake', metric 'kills') and emits match-end sorted desc` | gameState.js | `test/snake/lifecycle.test.js` | integration | 2 players with scores; `endMatch()` → stubbed `leaderboardStore.archive` called twice w/ `gameType:'snake', metric:'kills'`; `match-end` payload `{scores, leaderboard}` sorted by score desc. | stub `leaderboardStore.archive` (assign + restore in `t.after`); `t.after` also `leaderboardStore.clear()` if using real store |
| 18 | `endMatch: clears playerStore, sets status 'ended', clears intervals, calls _onEnd` | gameState.js | `test/snake/lifecycle.test.js` | integration | After `endMatch()`: `playerStore.all()` empty, `_tickHandle === null`, `_foodInterval === null`, `onEnd` spy called once. | `onEnd` spy in ctor opts |
| 19 | `endMatch: second call is a no-op (idempotent)` | gameState.js | `test/snake/lifecycle.test.js` | integration | Call twice → single `match-end` emit, `archive` called once per player only. | archive spy counts |
| 20 | `_tick: time-limit expiry → endMatch + match-end emitted` | gameState.js | `test/snake/lifecycle.test.js` | integration | `timeLimitMs: 1000`; after `startMatch`, set `_matchStartAt = Date.now() - 2000`; `_tick()` → `status 'ended'`, `match-end` emitted. (Note: this is the ONLY win path — last-alive is gone; see stale-test table.) | seed `_matchStartAt` |

### P1 — important behavior, error paths, derived state

| # | Test name | File under test | Proposed test file | Type | Scenario + edge cases | Setup needs |
|---|---|---|---|---|---|---|
| 21 | `_tick: emits snake-update with public-shaped players + scores map` | gameState.js | `test/snake/lifecycle.test.js` | integration | One `_tick` → `snake-update` payload players have public fields (`id,name,color,lat,lng,heading,alive,score,kills,tailPoints,spawnedAt`), no private fields; `scores[id] = {name,color,score,kills}`. | io stub |
| 22 | `updateLocation: stores client-supplied tailPoints and score verbatim; wrong types ignored` | gameState.js | `test/snake/updateLocation.test.js` | unit | Pass `tailPoints` array + `score` → stored as-is; then call without them (undefined) and with non-array/non-number → previous values retained; `lastSeen` updated; non-number heading ignored. This is the real replacement for vacuous `tailTrim` coverage. | playerStore assertions |
| 23 | `updateLocation: unknown player id → no-op, no throw` | gameState.js | `test/snake/updateLocation.test.js` | unit | `updateLocation('ghost', ...)` → store stays empty. | — |
| 24 | `updateLocation: first update lazily initializes arena when constructed without center` | gameState.js | `test/snake/updateLocation.test.js` | unit | Ctor without `centerLat/centerLng` → `_bbox` null; after `updateLocation('p1', 51.5, -0.12, 0)` → `_bbox` set around that point and `_foods` populated to target. | assert `_bbox`/`_foods` |
| 25 | `startMatch: emits match-start with {bbox, foods, timeLimitMs, matchStartAt}` | gameState.js | `test/snake/lifecycle.test.js` | integration | Assert payload shape; `matchStartAt ≈ Date.now()`; `status 'active'`. | io stub |
| 26 | `startMatch: second call is a no-op` | gameState.js | `test/snake/lifecycle.test.js` | integration | Call twice → one `match-start`, one tick handle (`_tickHandle` unchanged). | — |
| 27 | `startMatch: after endMatch, does not restart` | gameState.js | `test/snake/lifecycle.test.js` | integration | `endMatch()` then `startMatch()` → `matchActive` stays false, no new `match-start`. | — |
| 28 | `resolveCollisions: spawn-grace player is excluded as both victim and killer` | collisions.js | `test/snake/resolveCollisions.test.js` | unit | Player A `spawnedAt: now` overlapping B's head/tail → zero kills either direction. Exercises the `alive && !inGrace` filter + in-loop grace check. | pure fn, players as plain-object map |
| 29 | `resolveCollisions: head-on-tail takes priority over head-on-head (break after tail hit)` | collisions.js | `test/snake/resolveCollisions.test.js` | unit | A's head within radius of B's head AND B's tail → kill entry is `{killerId: B, victimId: A}`, not the null-killer pair. | same |
| 30 | `resolveCollisions: player's own tail never kills them` | collisions.js | `test/snake/resolveCollisions.test.js` | unit | Player with `tailPoints` containing own head position → no kills (`other.id === p.id` skip). Documents self-collision immunity. | same |
| 31 | `resolveCollisions: head exactly at COLLISION_RADIUS_M counts as a hit (<= boundary)` | collisions.js | `test/snake/resolveCollisions.test.js` | unit | Place heads at exactly `COLLISION_RADIUS_M` apart via `metersToDegLat` → kill emitted; at `+0.1 m` → none. | shared gridUtils math |
| 32 | `resolveCollisions: alive:false players are skipped entirely` | collisions.js | `test/snake/resolveCollisions.test.js` | unit | Overlapping dead player → no kills, not even as killer via their tail. | same |
| 33 | `snapshot(): returns full late-joiner shape` | gameState.js | `test/snake/snapshot.test.js` | integration | After start with 1 player + seeded foods: snapshot has `gameType:'snake'`, `matchActive`, `foodCountTarget`, `foodRespawnIntervalMs`, `timeLimitMs`, `matchStartAt`, `bbox`, `foods`, public `players`, `scores`, numeric `serverNow`. | io stub |
| 34 | `food respawn interval: depleted food is replenished and food-update emitted only when count changes` | gameState.js | `test/snake/foodRespawn.test.js` | integration | `foodRespawnIntervalMs: 20`; `startMatch`; `game._foods = []`; `await sleep(~80)` → `_foods.length === target` and `food-update` emitted. Second wait with foods already at target → no extra `food-update` (count events). | short real interval + `setTimeout` sleep; `t.after(endMatch)` (only test allowed to rely on real timers — no fake-timer lib per convention) |
| 35 | `_spawnPoint: samples fall inside _bbox; without bbox returns center` | gameState.js | `test/snake/players.test.js` | unit | With `_bbox` set: 200 samples → all within south/north/west/east. Ctor with no center and `_bbox` null → returns `{lat:0,lng:0}`; with center → returns center. | loop, bounds assertions |
| 36 | `addPlayer: initial shape, default name, color rotation wraps` | gameState.js | `test/snake/players.test.js` | unit | No-name player → `P-${id.slice(0,4)}`; `alive:true, score:0, kills:0, tailPoints:[]`; add `COLORS.length + 1` players → colors wrap modulo. | — |
| 37 | `socket location-update: non-number/missing lat or lng → updateLocation not called` | snake/socketHandlers.js | `test/snake/socketHandlers.test.js` | socket-level | Invoke handler with `{}`, `{lat:'x'}`, `{lng:undefined}` → recorder game sees zero calls; valid payload → called once with `(socket.id, lat, lng, heading, tailPoints, score)`. | fake socket capturing `on()` handlers + recorder game stub |
| 38 | `socket eat_food: non-string foodId → ignored; valid string → eatFood(socket.id, foodId)` | snake/socketHandlers.js | `test/snake/socketHandlers.test.js` | socket-level | `{foodId: 123}`, `{}`, `undefined` payload → ignored; `{foodId:'f1'}` → delegated. | same |
| 39 | `socket clash_ack: non-string clashId → ignored; valid string → clashAck(socket.id, clashId)` | snake/socketHandlers.js | `test/snake/socketHandlers.test.js` | socket-level | Same validation matrix as above. | same |

### P2 — nice-to-have

| # | Test name | File under test | Proposed test file | Type | Scenario + edge cases | Setup needs |
|---|---|---|---|---|---|---|
| 40 | `constructor: throws without io / without roomId` | gameState.js | `test/snake/players.test.js` | unit | `new SnakeGameState({})` and `{io}` → throws. | — |
| 41 | `resolveCollisions: inGrace flag is persisted on stored player objects` | collisions.js | `test/snake/resolveCollisions.test.js` | unit | Run once during grace → `p.inGrace === true` set on the (MemoryStore-referenced) object; after `spawnedAt` ages past grace → next call sets `inGrace = false`. Documents the hidden mutation of store objects. | MemoryStore-backed game or plain objects |
| 42 | `publicPlayer: tailPoints defaults to [] when falsy` | gameState.js | `test/snake/snapshot.test.js` | unit | Player with `tailPoints: null` in store → `snake-update` player entry has `tailPoints: []`. | seed store |

## Refactor-for-testability notes (optional, small)

1. **Extract the food-respawn interval callback** into a named method (e.g. `_replenishFoods()`). Test #34 currently needs a short real `setInterval` + sleep — an extracted method would make it a plain deterministic unit test and remove the only timing-sensitive test.
2. **`leaderboardStore` is imported as a singleton** — `endMatch` tests must monkeypatch `leaderboardStore.archive` or clear the shared store. Consider accepting an optional `leaderboard` ctor dep (like `stores`) to make injection explicit; not required, stubbing works.
3. **Decide the fate of `lastAlive.test.js` before implementing anything else** — it fails *and* hangs the whole `test/snake/` run (missing `t.after` + never-ending match). Either the last-alive rule should be restored to `_tick`/`_killPlayer` (product decision — `KILL_WIN_THRESHOLD` exists but is unused), or the test deleted. Similarly `eat.test.js` must be rewritten against `eatFood()` and `tailTrim.test.js` deleted/replaced by the real `updateLocation` tests above.
4. Minor: `resolveCollisions` mutates `p.inGrace` on store-owned objects — works because `MemoryStore` returns references, but under `ValkeyStore` (deserialized copies) the flag would **not** persist across ticks. Worth flagging; a test (#41) documents current behavior and would catch a Redis-swap regression differently.
