# Test Plan — Part B: clash-game

**Files reviewed (in scope):**
- `server/src/clash/gameState.js` (579 LOC — tick/capture/combat engine)
- `server/src/clash/gridUtils.js` (62 LOC — bbox → cell grid math)
- `server/src/clash/projectiles.js` (41 LOC — pure projectile fns)
- `server/src/clash/socketHandlers.js` (21 LOC — thin event wiring)

**Out of scope (shims):** `server/src/{gameState,projectiles,gridUtils}.js` are
re-export shims — confirmed, no tests planned. `server/src/shared/gridUtils.js`
(`distanceMeters`, `bboxAround`, `metersToDeg*`) is exercised indirectly but its
direct unit tests belong to Part A.

**Existing tests accounted for (do NOT re-propose):**
- `test/projectiles.test.js` — `spawnProjectile` tArrival math, `isExpired`
  boundary, `targetFromHeading` due-north distance, `attack()` → scheduled
  resolution → `hit` e2e, shield `blocked` e2e.
- `test/lateJoiner.test.js` — `snapshot()` includes in-flight projectile with
  tSpawn/tArrival; projectile dropped from snapshot after resolution.
- `test/cleanup.test.js` — `endMatch()` archives to `leaderboardStore`,
  `match-end` payload contains `leaderboard` array (via RoomRegistry).

## Coverage gaps summary

- **The tick is almost entirely untested.** Capture progress accrual,
  ownership flip at `CAPTURE_SECONDS`, contested cells, disconnected/dead
  occupants, progress reset on vacate, `grid-update` diffs, `_recountScores`,
  per-tick `timer` and match end at 0s — none covered.
- **Combat targeting is untested** beyond a single happy-path hit: range
  clamp to `ATTACK_RANGE_M`, auto-aim cone (`ATTACK_CONE_DEG=25`) vs. explicit
  `target`, heading fallback, miss/`expired` outcome, lives→0→`alive=false`.
- **Ammo is completely untested**: decrement, `ammo-update` scoped emit, block
  at 0, timed recharge (`_scheduleAmmoRecharge`), refill on respawn.
- **Respawn rules untested**: base-cell gate + `respawn-denied`, state reset,
  `player-respawn` emit.
- **Shield lifecycle partially untested**: `activateShield` emit and tick-time
  expiry (`player-shield-end`) are uncovered; only the blocked-hit path exists.
- **Reconnect/removal integrity untested**: `swapSocketId` re-keys players and
  remaps `cell.ownerId`/`progress.playerId`; `removePlayer` clears claims.
- **`snapshot()` completeness** beyond projectiles (grid shape, players public
  shape, ownership, scores, ammo fields, lobby state) untested.
- **`socketHandlers.js` validation untested** (non-number lat/lng ignored,
  delegation keyed on `socket.id`).
- **Review findings (possible bugs — see "Refactor-for-testability notes"):**
  `match-end` payload `scores` can be `{}` when `endMatch` runs before any
  tick/snapshot; ammo recharge scheduled before `swapSocketId` targets the
  stale socket id.

## Setup & conventions for all proposed tests

- `node --test`, `import test from 'node:test'`, `import assert from
  'node:assert/strict'` — match existing style.
- `makeRoomStores(roomId)` → real `MemoryStore`s (no `VALKEY_URL` in test env).
- io stub: for room-scoped assertions use the `cleanup.test.js` `makeIoStub`
  (records `{scope, event, payload}`); needed for `ammo-update` which is
  emitted via `io.to(playerId)`. Simple `makeIo` from `projectiles.test.js`
  suffices for room-wide events.
- **Drive ticks manually** — clash exposes a public `tick()` (snake uses
  `_tick()`). Never rely on the real `TICK_MS=200` interval; call
  `await game.tick()` directly. To inject elapsed time deterministically set
  `game._lastTick = Date.now() - dtMs` before `tick()` (dt is derived from
  `Date.now() - _lastTick`). Do not call `startMatch()` when pure-tick control
  is needed — instead set `game.matchActive = true` (accepted convention:
  tests freely mutate private fields). When `startMatch()` is used, always
  `t.after(() => game.endMatch())`.
- **Projectile resolution**: call `await game._resolveProjectile(projId)`
  directly for determinism instead of waiting on the real `setTimeout`; the
  pending timer later no-ops because the projectile record is deleted. The
  existing e2e timer-driven path is already covered.
- **Ammo recharge** uses real `setTimeout` (unref'd). Minimum legal
  `ammoRenewalMs` is 500 (constructor clamps `<500 → 5000`); tests must wait
  ~600ms real time. Keep to one or two such tests to limit suite time.
- Cell placement helper: place a player into a specific cell by reading the
  cell's `bounds` and using its center `(south+north)/2, (west+east)/2`, then
  `updateLocation`. To assert on a specific cell use `cellIdAt(game.grid,
  lat, lng)` or the known `'r_c'` id.

## Prioritized test list

### `server/test/clash/gridUtils.test.js` — pure unit tests

1. **`buildGrid slices a known bbox into expected rows×cols`** — unit —
   `buildGrid(bboxAround(51.5,-0.12,100), 10)` → `rows=10`, `cols=10`,
   `cells.length=100`, `cellMeters=10`, `bbox` echoed back. — **P1**
2. **`buildGrid cell ids, bounds and polygon are consistent`** — unit —
   cell `'0_0'` bounds start at `bbox.south/west`; `polygon` corners are
   `[lat,lng]` pairs matching its bounds (Leaflet convention); last cell id is
   `'9_9'`. — **P1**
3. **`buildGrid clamps to ≥1 row/col for a sub-cell bbox`** — unit — bbox
   smaller than `cellMeters` → `rows=1`, `cols=1`, single cell `'0_0'`. — **P2**
4. **`cellIdAt returns the containing cell id`** — unit — point at center of
   a known cell → correct `'r_c'` id. — **P1**
5. **`cellIdAt: south/west edges inclusive, north/east edges exclusive`** —
   unit — `lat==bbox.south && lng==bbox.west` → `'0_0'`; `lat==bbox.north` or
   `lng==bbox.east` → `null` (boundary drives respawn-denied/capture edges). — **P1**
6. **`cellIdAt returns null outside the bbox`** — unit — point beyond
   south/west/north/east → `null`. — **P2**
7. **`baseCellId returns the floor-center cell`** — unit — 10×10 → `'5_5'`;
   3×3 → `'1_1'`. — **P1**
8. **`targetFromHeading at 90° projects eastward ~range`** — unit —
   complements existing north-only test; at lat 51.5 heading 90 → `lng` grows,
   `distanceMeters ≈ 30` (documents latitude-dependence of the equirectangular
   approx). — **P2**

### `server/test/clash/capture.test.js` — tick / grid capture integration

9. **`tick accrues capture progress and emits cell-capture-start once`** —
   integration — player in cell, `matchActive=true`, `_lastTick = now-1000`,
   `tick()` → `cell.progress.elapsedMs ≈1000`, `ownerId` still null,
   `cell-capture-start` in `io._events`; second `tick()` emits no duplicate
   start. Setup: io stub, `makeRoomStores`, `initGrid`, `addPlayer`,
   `updateLocation` to a cell center. — **P0**
10. **`ownership flips at CAPTURE_SECONDS and grid-update diff carries the
    cell + recount`** — integration — single tick with `_lastTick = now-5100`
    → `cell.ownerId === player.id`, `color` set, `progress === null`;
    `grid-update` payload `{cells:[{id,ownerId,color}], scores}` with
    `scores[id].squares === 1` and `name`/`color` present. — **P0**
11. **`contested cell (two different-color players) accrues no progress`** —
    integration — A (red) and B (blue) in same cell, big-dt tick →
    `progress === null`, `ownerId === null`, no `cell-capture-start`, no
    `grid-update`. Edge: arrival order doesn't matter. — **P0**
12. **`same-color co-occupants still capture; claim credited to first
    occupant`** — integration — two same-color players (hardcode `color` in
    store to force) in one cell → single claim, `progress.playerId` is the
    first entry from `playerStore.all()`, ownership flips to that player.
    Documents `occupants[0]` behavior. — **P2**
13. **`standing in an already-owned cell does not restart capture`** —
    integration — pre-set `cell.ownerId === p.id` via `gridStore.set`, tick →
    no `cell-capture-start`, no `progress`, no `grid-update`. — **P1**
14. **`vacating a cell mid-capture clears progress`** — integration — accrue
    partial progress (small dt), move player to a different cell, tick →
    `cell.progress === null`; progress does not resume where it left off. — **P0**
15. **`disconnected occupant does not claim`** — integration — set
    `p.connected = false` in store, tick → no progress; mixed
    connected+disconnected same-color pair still captures via the connected
    one. — **P1**
16. **`dead player does not claim cells`** — integration — `p.alive=false`,
    tick → no progress, no `cell-capture-start`. — **P1**
17. **`no grid-update is emitted while capture is still in progress`** —
    integration — partial-progress ticks emit only `cell-capture-start` +
    `players-update` + `timer`; zero `grid-update` events until ownership
    flips. — **P1**
18. **`tick in lobby runs shield-expiry/players-update but no capture or
    timer`** — integration — `matchActive=false`, grid initialized, player in
    cell → no `progress`, no `timer` event; `players-update` still emitted. — **P1**
19. **`timer decrements by dt and emits 'timer' each tick while active`** —
    integration — `matchActive=true`, `_lastTick = now-2000`, tick →
    `remainingSeconds` drops ~2s, `timer` payload mirrors it. — **P1**
20. **`timer reaching zero ends the match`** — integration — set
    `remainingSeconds = 0.05`, `_lastTick = now-1000`, tick → `match-end`
    emitted, `status==='ended'`, `matchActive===false`, tick handle cleared
    (subsequent `tick()` early-returns). — **P0**
21. **`tick emits players-update with the public player shape`** —
    integration — payload players expose `{id,name,color,lat,lng,heading,
    lives,ammo,shieldActive,alive,connected}`; assert `sessionId`,
    `shieldUntil`, `lastSeen` are absent. — **P1**
22. **`re-entering a cell restarts capture from zero`** — integration —
    partial capture → vacate → return → new `cell-capture-start`,
    `elapsedMs` restarts near 0 then grows by dt. — **P2**
23. **`cells owned by a removed player don't count toward any score`** —
    integration — player owns a cell, `removePlayer`, tick with another
    player's capture → `scores` tally omits the removed player (documents
    `tally[c.ownerId]` membership check in `_scores`). — **P2**

### `server/test/clash/combat.test.js` — attack targeting + resolution

24. **`attack clamps an out-of-range explicit target to ATTACK_RANGE_M`** —
    integration — target 100m away → `projectile-spawn` payload `target` is
    ≈30m from attacker, same direction (assert via `distanceMeters` and
    bearing delta small). — **P0**
25. **`attack uses an in-range explicit target verbatim`** — integration —
    target 10m away → `proj.target` equals given lat/lng exactly. — **P1**
26. **`attack auto-aims at the nearest enemy inside the 25° cone`** —
    integration — heading 0; enemy E1 at 10m bearing ~0°, enemy E2 at 5m
    bearing ~40° (outside cone) → spawned `target` ≈ E1's position. Edge:
    enemy outside `ATTACK_RANGE_M` is ignored even inside the cone. — **P0**
27. **`attack falls back to targetFromHeading at full range when no enemy in
    cone`** — integration — heading-only shot with no nearby enemies →
    `target ≈ 30m` along heading (compare against `targetFromHeading`
    output). — **P1**
28. **`attack heading argument overrides stored heading; non-number falls
    back`** — integration — player.heading=90 but `attack(id,{heading:0})` →
    projectile flies bearing ~0; `attack(id,{heading:'x'})` → uses stored
    heading. — **P2**
29. **`attack by dead or unknown player is a no-op`** — integration —
    `alive=false` and missing id → no `projectile-spawn`, no store write, no
    ammo change. — **P1**
30. **`attack after endMatch is a no-op`** — integration — `status='ended'`
    → early return, nothing emitted. — **P1**
31. **`resolve: miss when nobody is within HIT_RADIUS_M`** — integration —
    attack at empty ground, capture `proj.id`, `await
    game._resolveProjectile(id)` → `projectile-resolved` `{outcome:'expired',
    victimId:null}`; record deleted from `projectileStore`. — **P0**
32. **`resolve: hit decrements lives and lives→0 marks dead`** — integration —
    victim at target; set `victim.lives=1` via store → resolve →
    `outcome:'hit'`, `player-hit` payload `{id, lives:0, alive:false}`,
    `playerStore` shows `alive===false`. (Non-lethal decrement is covered by
    the existing e2e test; this pins the death boundary.) — **P0**
33. **`resolve: nearest victim inside the hit radius is chosen`** —
    integration — two enemies within 1.5m of target at different distances →
    `victimId` is the closer one. Edge: victim exactly at 1.5m hits,
    just-over misses. — **P1**
34. **`resolve: an expired shield does not block`** — integration — victim
    `shieldActive=true` but `shieldUntil < now` → `outcome:'hit'` (complements
    the existing `blocked` test; pins the `shieldUntil > now` check). — **P1**
35. **`resolve: attacker and dead players are excluded from victim scan`** —
    integration — attacker standing on own target point → `expired`; dead
    enemy on target → `expired`. — **P1**
36. **`resolve is idempotent / no-op for missing or non-in-flight
    projectile`** — integration — call `_resolveProjectile` twice → only one
    `projectile-resolved`; call on unknown id → nothing emitted. — **P1**
37. **`resolve is a no-op once status is ending/ended`** — integration —
    `game.status='ended'` then `_resolveProjectile` → early return, projectile
    untouched. — **P1**

### `server/test/clash/ammo.test.js` — ammo rules (needs scope-recording io stub)

38. **`attack decrements ammo and emits scoped ammo-update`** — integration —
    `maxAmmo:3` → after attack, `player.ammo===2`; io event with
    `scope===attackerId`, `payload {ammo:2, maxAmmo:3}`. — **P0**
39. **`attack is blocked at zero ammo`** — integration — `maxAmmo:1`, attack
    twice → exactly one `projectile-spawn`, `ammo` stays 0, no negative. — **P0**
40. **`ammo recharges +1 after ammoRenewalMs and emits ammo-update`** —
    integration — `maxAmmo:2, ammoRenewalMs:500`, attack → ammo 1, wait ~600ms
    → `ammo===2`, second `ammo-update` emitted to the player's scope. Real
    timer — one of the few wall-clock tests. — **P1**
41. **`recharge never exceeds maxAmmo`** — integration — schedule recharge
    while `ammo===maxAmmo` (manually `game._scheduleAmmoRecharge(id)`), wait
    → `ammo` capped at `maxAmmo`. — **P2**
42. **`maxAmmo:null means unlimited`** — integration — default constructor →
    `attack` never decrements (`ammo` stays null), no `ammo-update` events. — **P1**
43. **`respawn refills ammo to maxAmmo and emits scoped ammo-update`** —
    integration — spend ammo, kill player, place at base cell, `respawn` →
    `ammo===maxAmmo` + `ammo-update`. — **P1**

### `server/test/clash/shield.test.js`

44. **`activateShield sets state and emits player-shield`** — integration —
    `shieldActive===true`, `shieldUntil > now`, `player-shield` payload
    `{id, until}` matches. — **P1**
45. **`shield expires on the next tick → player-shield-end`** — integration —
    set `p.shieldUntil` in the past via store, `tick()` → `shieldActive` false,
    `player-shield-end {id}` emitted. — **P0**
46. **`activateShield on dead/unknown player is a no-op`** — integration — no
    `player-shield` event, store unchanged. — **P1**

### `server/test/clash/players.test.js` — join/move/reconnect/remove/respawn

47. **`addPlayer spawns at base center with default state`** — integration —
    after `initGrid`, `addPlayer` → `lat/lng` equal `game._baseCenter()`,
    `lives===3`, `alive`, `connected`, `ammo===maxAmmo` (or null), color from
    `COLORS` rotation. — **P1**
48. **`addPlayer before grid init spawns at {0,0} and defaults the name`** —
    integration — no `initGrid` → `lat===0,lng===0`; `addPlayer(id)` with no
    name → `P-<id-prefix>`; successive players get successive `COLORS`. — **P2**
49. **`updateLocation updates position/heading and ignores dead players`** —
    integration — alive player moves, `lastSeen` refreshes, non-number
    `heading` leaves prior heading; `alive=false` → lat/lng unchanged. — **P1**
50. **`updateLocation seeds the grid centered on the first fix`** —
    integration — fresh game (grid null) → `updateLocation(lat,lng)` builds
    grid whose bbox is centered on that point (`bboxAround` check). — **P1**
51. **`ensureGridFromPlayer is a no-op once the grid exists`** — integration —
    init at loc A → `ensureGridFromPlayer(locB)` → bbox still centered on A
    and existing `gridStore` contents untouched (no re-clear). — **P1**
52. **`getPlayerBySessionId finds the player and its socketId`** — unit-ish
    integration — add with `sessionId` → returns `{player, socketId}`;
    unknown/missing sessionId → `null`. — **P1**
53. **`swapSocketId re-keys the player and remaps grid ownerId +
    progress.playerId`** — integration — player owns a cell and has an
    in-progress claim → `swapSocketId(old,new)` → `playerStore.get(new)` has
    `id===new`, `connected===true`, old key gone; `cell.ownerId===new`,
    `cell.progress.playerId===new`. Reconnect data-integrity — core P0. — **P0**
54. **`swapSocketId on unknown old id is a no-op`** — integration — no throw,
    stores unchanged. — **P2**
55. **`removePlayer deletes the player and clears their in-progress claim but
    keeps owned cells`** — integration — player with owned cell + active
    claim → `removePlayer` → player gone, `cell.progress===null`,
    `cell.ownerId` unchanged (documents current ownership retention). — **P1**
56. **`respawn at the base cell resets lives/alive/shield and emits
    player-respawn`** — integration — player with `lives=0, alive=false,
    shieldActive=true` positioned in `baseCellId` → `respawn` → `lives===3`,
    `alive===true`, `shieldActive===false`, `player-respawn {id, lives:3}`. — **P0**
57. **`respawn outside the base cell emits respawn-denied`** — integration —
    player in a non-base cell → `respawn-denied {id, reason:'not-at-base'}`,
    lives/alive unchanged. — **P0**
58. **`respawn no-ops for unknown player or uninitialized grid`** —
    integration — bogus id / no `initGrid` → nothing emitted, no throw. — **P2**
59. **`respawn while already alive still resets lives`** — integration —
    alive player at base with `lives=1` → `lives===3` (documents that respawn
    does not gate on `!alive` — flag if this is deemed an exploit). — **P2**

### `server/test/clash/lifecycle.test.js` — startMatch / endMatch / timers

60. **`startMatch emits match-start once and is idempotent`** — integration —
    call twice → one `match-start {remainingSeconds}`; `status='active'`,
    `matchActive=true`; `t.after(() => game.endMatch())`. — **P1**
61. **`startMatch is rejected after endMatch`** — integration — end then
    `startMatch()` → still `ended`, no `match-start`, no new interval. — **P1**
62. **`endMatch is idempotent`** — integration — second call returns
    immediately; exactly one `match-end` event; `_onEnd` invoked once. — **P1**
63. **`endMatch clears pending projectile and ammo timers`** — integration —
    attack with a long flight (30m target ≈6s), `endMatch()`, wait past
    `tArrival` → no `projectile-resolved` emitted; `game._projectileTimers`
    and `_ammoTimers` empty. — **P1**
64. **`match-end payload has scores + leaderboard sorted desc by squares`** —
    integration — arrange two players owning different cell counts (via
    `gridStore.set` + a tick or `snapshot()` to populate caches), `endMatch` →
    `payload.leaderboard` sorted, `payload.scores` tally matches ownership.
    NOTE: asserting `scores` may expose the stale-cache gap below — expect
    `scores` to be `{}` if no `_recountScores` ran; that failure is the point. — **P0**
65. **`endMatch purges player/grid/projectile stores`** — integration — after
    `endMatch`, all three `MemoryStore`s are empty. — **P1**

### `server/test/clash/snapshot.test.js`

66. **`snapshot in lobby returns grid:null and inert fields`** — integration —
    fresh `GameState` (no `initGrid`, no players) → `{grid:null, players:[],
    ownership:[], projectiles:[], matchActive:false,
    remainingSeconds:MATCH_SECONDS, maxAmmo:null, ammoRenewalMs:null}`;
    `serverNow` is a number. — **P1**
67. **`snapshot exposes full grid meta, public players, ownership and ammo
    fields`** — integration — initialized game with `maxAmmo` set → `grid`
    has `{rows,cols,cellMeters,bbox,cells:[{id,polygon}],baseCellId}`;
    `ownership` entries are `{id,ownerId,color}` only (no `progress` leak);
    players carry the public shape (see #21); `ammoRenewalMs` is a number;
    `scores` tally reflects `gridStore` ownership. — **P0**
68. **`snapshot ownership reflects live gridStore, not the grid template`** —
    integration — own a cell via store, `snapshot()` → that cell's
    `ownerId`/`color` present in `ownership`. — **P1**

### `server/test/clash/socketHandlers.test.js` — socket-level, recording fake game

Setup: fake socket `{id, data:{}, _h:{}, on(ev,fn){this._h[ev]=fn}}`; fake
game whose methods (`updateLocation`, `attack`, `activateShield`, `respawn`)
record `{method, args}`.

69. **`location-update with non-number lat/lng is ignored`** — socket-level —
    invoke handler with `{lat:'x', lng:1}`, `{}`, `undefined` → no game call;
    `{lat:1, lng:2, heading:90}` → `updateLocation('s1', 1, 2, 90)`. — **P1**
70. **`player-attack delegates to game.attack with socket.id and payload`** —
    socket-level — `{heading:10, target:{lat,lng}}` →
    `attack('s1', {heading:10, target})`; empty payload → `attack('s1',
    {heading:undefined, target:undefined})`. — **P1**
71. **`player-shield and player-respawn delegate with socket.id`** —
    socket-level — fire both → `activateShield('s1')`, `respawn('s1')`. — **P1**

## Refactor-for-testability notes (review findings — flag, don't fix here)

1. **`match-end` `scores` can be empty (likely bug).** `endMatch` emits
   `this._scores()`, which reads `_lastPlayersCache`/`_lastCellsCache` — only
   populated by `tick()`/`snapshot()`/`_recountScores()`. A match that ends
   without a prior tick (e.g. host ends early, or test calls `endMatch`
   directly) emits `scores:{}` while `leaderboard` is correct (computed from
   fresh store reads). Suggested fix: `await this._recountScores()` at the top
   of `endMatch` before the purge. Planned test #64 will expose this.
2. **Duplicated cone constant.** `ATTACK_CONE_DEG = 25` is redeclared in
   `gameState.js` while `AUTO_AIM_CONE_DEG = 25` is exported from
   `projectiles.js`; they can silently diverge. Suggest importing the shared
   constant.
3. **Ammo recharge vs `swapSocketId`.** `_scheduleAmmoRecharge` closes over
   the old socket id, so a recharge scheduled before a reconnect writes to a
   deleted player key and emits `ammo-update` to the stale scope. Low-impact;
   a test documenting this could be added to `players.test.js` if considered
   worth pinning (currently P2/omitted).
4. **`respawn` does not gate on `!alive` or `matchActive`** — an alive player
   at base can reset lives to 3 at will. Possibly intended; test #59 pins the
   behavior for review.
5. **`tick()` name differs from snake's `_tick()`** — clash's public `tick()`
   is what tests should call; no refactor needed, noted to avoid confusion.
6. **`endMatch` is invoked un-awaited inside `tick()`** (line ~471) — fine,
   but tests asserting post-`endMatch` state after a zero-timer tick should
   `await` one microtask/`await game.endMatch()` again (idempotent) before
   asserting.
