# Feature Plan — Geo Snake (second game) + minimal multi-game extraction

> Strategy: **build snake as a sibling game in the same repo, sharing only
> demonstrably-shared infra. Defer the `GameMode` abstraction until two real
> implementations exist.** This plan delivers (a) a small refactor PR that
> introduces seams without changing Geo Clash behaviour, and (b) a fully
> playable Geo Snake MVP behind a lobby toggle.

## Goals

- A real-time multiplayer **Geo Snake** game played on the same OSM map shell.
- Snakes move based on the player's real (or simulated) location. A "head" is
  the player's GPS point; a "tail" trails behind it along the last N seconds
  of travel.
- Food pellets spawn inside the arena; eating one (head within radius R)
  extends the tail by a configurable amount.
- Colliding **head into another player's tail** kills that player. Self
  collisions are ignored. Head-vs-head is a mutual kill.
- Match runs until time-out or last-snake-standing; final scores archived in
  the shared leaderboard with `gameType: 'snake'`.
- **Geo Clash continues to work unchanged.** No regressions, no shared
  gameplay code paths.

## Non-goals (explicit)

- No `GameMode` abstraction now. Snake gets its own `gameState.js` by
  copy-and-diverge. The abstraction is a *later* PR informed by both games.
- No native mobile. Web only, mobile-first.
- No new map provider, no API keys. Leaflet + OSM only.
- No DB. Continue using the in-memory + Valkey-shaped stores.
- No spatial index / quadtree on day 1. Brute-force collision is fine at
  MVP scale (≤16 players × ≤200 tail segments).

## Architecture summary

```
/server/src/
  shared/
    memoryStore.js     ← moved
    valkeyStore.js     ← moved
    roomLock.js        ← moved
    gridUtils.js       ← geo math only (distanceMeters, bboxAround, metersToDeg*)
    timeSync.js        ← extracted time-sync handler (new file)
  clash/
    gameState.js       ← moved from server/src/gameState.js
    projectiles.js     ← moved
    socketHandlers.js  ← clash-only gameplay events split out
    gridUtils.js       ← grid slicing (buildGrid, cellIdAt, baseCellId) stays clash-specific
  snake/
    gameState.js       ← new
    food.js            ← new
    collisions.js      ← new
    socketHandlers.js  ← new
  roomRegistry.js      ← gains gameType + factory map
  socketHandlers.js    ← thin top-level: lobby + dispatch to per-game handlers
  index.js
```

```
/client/src/
  shared/
    socket.js          ← moved
    MapView.jsx        ← moved (game-agnostic)
    hooks/             ← useGeolocation, useRooms, useTimeSync (new)
  clash/
    GameScreen.jsx, HUD, ControlPanel, ProjectileLayer, PostMatchScreen, SimPanel
  snake/
    GameScreen.jsx     ← new
    FoodLayer.jsx      ← new
    SnakeLayer.jsx     ← new (renders heads + tails)
    HUD.jsx            ← new (length, kills, alive count)
  LobbyScreen.jsx      ← shows game-type tabs; create flow picks type
  App.jsx              ← dispatches to clash/snake GameScreen by room.gameType
```

## Phased delivery

The plan is split into three phases. Each phase is a self-contained PR-worth
of work and ends with a green test run + a manual smoke check.

---

### Phase 1 — Refactor for seams (no behaviour change)

Goal: make room for a second game without touching gameplay logic.

1. **Move shared modules under `server/src/shared/`.**
   - `memoryStore.js`, `valkeyStore.js`, `roomLock.js` → `shared/`.
   - Split `gridUtils.js`: pure geo helpers
     (`distanceMeters`, `bboxAround`, `metersToDegLat/Lng`) → `shared/gridUtils.js`;
     grid slicing helpers (`buildGrid`, `cellIdAt`, `baseCellId`,
     `CELL_METERS`) → `clash/gridUtils.js`.
   - Update imports. No logic changes.
2. **Move clash gameplay under `server/src/clash/`.**
   - `gameState.js`, `projectiles.js` → `clash/`.
3. **Split socket handlers.**
   - New `clash/socketHandlers.js` exporting `registerClashHandlers(socket, game)`
     with the gameplay events (`location-update`, `player-attack`,
     `player-shield`, `player-respawn`).
   - Top-level `socketHandlers.js` keeps connection lifecycle + lobby events
     (`rooms-list`, `room-create`, `room-join`, `room-leave`, `time-sync`,
     `disconnect`) and dispatches gameplay events to the correct per-game
     registrar based on `room.gameType`.
   - Extract `time-sync` handler into `shared/timeSync.js` as a tiny pure
     `registerTimeSync(socket)` helper.
4. **Room meta gains `gameType`.**
   - Add `gameType: 'clash' | 'snake'` to room meta (default `'clash'`).
   - `RoomRegistry.create` accepts a `gameType` arg; stores it in meta and
     in the broadcasted list.
   - Introduce a factory map in `roomRegistry.js`:
     ```js
     const GAME_FACTORIES = {
       clash: (opts) => new ClashGame(opts),
       // snake added in Phase 2
     };
     ```
     and use it to construct the per-room game instance.
   - For Phase 1, only `clash` is registered. Posting a different `gameType`
     returns `400 unsupported-game-type`.
5. **Generalize leaderboard schema.**
   - `archive({...})` now takes `{ score, metric, gameType, ...meta }`
     instead of `squaresCaptured`. Clash callers pass
     `{ score: squares, metric: 'squares', gameType: 'clash' }`.
   - `top(limit, { gameType } = {})` filters by `gameType` when provided.
   - `/api/leaderboard?gameType=clash` honoured; missing → all.
6. **Client mirror.**
   - Move `socket.js`, `MapView.jsx`, hooks into `client/src/shared/`.
   - Move existing game-specific components to `client/src/clash/`.
   - `App.jsx` dispatches by `room.gameType`; only `clash` known for now.
   - `LobbyScreen.jsx` shows the room's game type as a badge but the
     create form remains clash-only this phase.
7. **Tests.**
   - Update existing server tests to new paths.
   - Add a small `roomRegistry.test.js` case: `create({ gameType: 'snake' })`
     fails until Phase 2 registers the factory.
   - Add a `leaderboard.test.js` case: archive + top filtering by
     `gameType`.

**Phase 1 exit criteria**
- `npm --prefix server test` is green.
- `npm run dev` + manual smoke: existing Geo Clash flow (create, join, capture,
  attack, end) is unchanged.
- No production behaviour change.

---

### Phase 2 — Geo Snake MVP (server)

Goal: a fully playable snake server-side, behind `gameType: 'snake'`.

1. **Design constants (`snake/constants.js` or inline)**
   - `TICK_MS = 100` (faster than clash; tails need smooth interpolation).
   - `ARENA_SIDE_METERS = 200` (configurable from lobby).
   - `TAIL_SECONDS_PER_FOOD = 2` — eating 1 food extends tail by ~2 s of
     travel history.
   - `STARTING_TAIL_SECONDS = 5`.
   - `MAX_TAIL_SECONDS = 600` (hard safety cap).
   - `FOOD_RADIUS_M = 2` (head within this distance eats it).
   - `FOOD_COUNT_TARGET = 30` (spawner refills until reached).
   - `FOOD_SPAWN_INTERVAL_MS = 1500`.
   - `HEAD_RADIUS_M = 1.5` and `TAIL_HIT_RADIUS_M = 1.5` for collision.
   - `MATCH_SECONDS = 5 * 60` (initial).
2. **`snake/food.js`** — pure functions:
   - `spawnFood(bbox, rng=Math.random)` → `{ id, lat, lng, spawnedAt }`.
   - Random uniform within bbox; for MVP no avoidance of existing food.
3. **`snake/gameState.js`** — same shape/contract as clash:
   - Constructor `({ io, roomId, stores, roomName, onEnd, arenaSideMeters })`.
   - Stores: `playerStore`, `foodStore`. No grid store.
   - Per-player state:
     ```js
     {
       id, name, color, alive,
       lat, lng, heading, lastSeen,
       tail: [{ lat, lng, t }],  // newest-last; trimmed by tail-length budget
       tailSeconds,               // current target length in seconds
       kills, score,
     }
     ```
   - `addPlayer`, `removePlayer`, `updateLocation` (appends to tail,
     trims by `tailSeconds`), `startMatch`, `endMatch` (archives kills+score
     to leaderboard with `gameType: 'snake'`, `metric: 'kills'`).
   - `tick()`:
     - Trim every tail to its `tailSeconds` budget (drop oldest waypoints).
     - **Food eat resolution**: for each alive player, for each food, if
       `distanceMeters(head, food) <= FOOD_RADIUS_M` → consume, grow
       `tailSeconds += TAIL_SECONDS_PER_FOOD`, increment `score`, emit
       `snake:food-eaten` + `snake:food-despawn`.
     - **Collision resolution**: brute-force head-vs-segment check.
       For every alive head H, for every other alive player P, for every
       consecutive segment `(P.tail[i], P.tail[i+1])`, compute the closest
       point on the segment to H; if distance ≤ `TAIL_HIT_RADIUS_M`, H is
       killed (`alive = false`, emit `snake:player-died`,
       `P.kills += 1`). Head-vs-head: both die in same tick.
     - Broadcast `snake:players-update` every tick with compact public
       state: `{ id, name, color, alive, lat, lng, heading, tailLen, score, kills }`.
       Broadcast `snake:tail-update` at lower rate (every N ticks, e.g.
       every 3rd tick = 300ms) with full tail polylines; clients
       interpolate the head between updates.
     - Decrement `remainingSeconds`; on zero → `endMatch`.
   - **Food spawner**: small internal interval (or driven from tick) refills
     food up to `FOOD_COUNT_TARGET`, capped by `FOOD_SPAWN_INTERVAL_MS`
     between spawns. Emit `snake:food-spawn` on each new food.
   - `snapshot()`: `{ arena: { bbox }, foods, players: [...with tails],
     remainingSeconds, serverNow, matchActive }`.
4. **`snake/socketHandlers.js`** — `registerSnakeHandlers(socket, game)`:
   - `location-update` → `game.updateLocation(...)` (same shape as clash).
   - No attack/shield/respawn yet (snake MVP has none).
   - Optional `snake:boost` event placeholder for Phase 3.
5. **RoomRegistry**: register `snake` factory; on `create({ gameType:
   'snake', ... })` build a `SnakeGame` and seed its arena from
   `centerLat/Lng + arenaSideMeters`.
6. **Server tests** (new files in `server/test/snake/`):
   - `food.test.js` — `spawnFood` stays within bbox.
   - `tailTrim.test.js` — `updateLocation` + `tick` trims tail to budget.
   - `eat.test.js` — head within `FOOD_RADIUS_M` consumes food, length grows.
   - `collide.test.js` — head into another tail kills the head; not the
     other player. Self-tail proximity does **not** kill.
   - `headOnHead.test.js` — mutual kill.
   - `gameType.test.js` — full create→join→tick→endMatch flow archives to
     leaderboard with `gameType: 'snake'`.

**Phase 2 exit criteria**
- All new tests green.
- Manual server smoke via raw socket.io client (script in
  `server/scripts/snake-smoke.mjs`): create snake room, two bots crawl,
  one eats food, head-tail collision kills.

---

### Phase 3 — Geo Snake MVP (client)

Goal: a working snake UI on mobile, parity with clash's polish level.

1. **`client/src/snake/GameScreen.jsx`**: structurally mirrors clash's
   screen but subscribes to `snake:*` events.
   - Local state: `arenaBbox`, `players` (with `tail`), `foods`,
     `remainingSeconds`, `myId`, `skewMs`, `matchEnded`, `finalLeaderboard`.
   - Streams `location-update` (250 ms throttle) exactly like clash.
   - Renders `<MapView>` with the arena bbox highlighted; `<SnakeLayer>`
     and `<FoodLayer>` overlays.
2. **`client/src/snake/SnakeLayer.jsx`**:
   - For each player: render the tail as a `<Polyline>` colored by player
     color; render the head as a `<CircleMarker>` with a small directional
     wedge for heading.
   - Dead players: render greyed-out tail, fade-out within ~2 s, then drop.
   - **Head interpolation**: between `snake:players-update` packets,
     linearly extrapolate the head position from the last two known
     points using the server timestamp + `skewMs`. Identical pattern to
     the projectile interpolation in clash, just applied to heads.
3. **`client/src/snake/FoodLayer.jsx`**:
   - Render each food as a small pulsing `<CircleMarker>` (green).
   - Spawn/despawn animations are CSS-only (no extra deps).
4. **`client/src/snake/HUD.jsx`**:
   - Top-right: remaining time.
   - Top-left burger menu (re-use clash's pattern).
   - Center-bottom panel: your length (seconds → segments approximation),
     kills, alive count.
   - Leaderboard expandable drawer like clash.
5. **`LobbyScreen` updates**:
   - Add a **Game type** segmented control: `Geo Clash` | `Geo Snake`.
   - Filter the room list by the selected type (server-side filter is
     optional; client-side `rooms.filter(r => r.gameType === selected)` is
     sufficient for MVP).
   - Create form: when `snake` is selected, hide clash-only fields
     (cell size, squares per side) and show snake-only fields (arena side
     meters slider). Validation gated by `position + connected`.
6. **`App.jsx` dispatch**:
   - On `onJoined({ roomId, snapshot, gameType })` route to either
     `<ClashGameScreen>` or `<SnakeGameScreen>`.
   - Carry `gameType` through the join ack (server already includes it in
     `room` meta).
7. **Sim path**:
   - `SimPanel` continues to work; sim WASD movement just updates the
     same `simPos`. Snake reads it via the existing `useGeolocation`
     hook. No changes there.
   - Add a "Spawn snake bot" button mirroring clash's bot spawner. Bots
     wander randomly inside the bbox, occasionally turning, with no
     attack/shield logic.
8. **PWA / icons / styling**: re-use existing PWA setup. Add a snake
   variant of the favicon only if trivial; otherwise re-use.

**Phase 3 exit criteria**
- `npm run dev` and play snake locally with two browser tabs + sim.
- Mobile smoke (iOS Safari + Android Chrome): no layout breakage, touch
  targets ≥44 px, map remains above the fold.
- Geo Clash flow regression-tested by manual smoke.
- Deploy preview (Vercel preview + a temporary Cloud Run revision) loads
  both games.

---

## Risks and mitigations

- **Performance — brute-force collisions.** With N players × M segments
  per tick, complexity is O(N² × M). At MVP scale (N≤16, M≤200) this is
  ~640k ops/s at 100ms tick — fine. Plan a spatial hash later if N grows.
  Add a `tick_ms` metric to the server log so we notice when this matters.
- **GPS jitter producing false "self-collisions".** Mitigated by explicit
  self-skip in collision loop (we never check head against own tail in
  MVP). Also leave a small "neck" gap (skip the freshest 0.5 s of
  segments) when checking against *other* players' tails to be forgiving
  about adjacent-frame head positions.
- **Tail polyline payload size.** A 600 s tail at 4 Hz is 2400 points.
  Mitigation: server resamples tails to a max of e.g. 120 points per
  player when sending `snake:tail-update`. Send deltas (`appended` +
  `dropped`) instead of full tail when possible (post-MVP optimisation).
- **`Redis` TLS hardcode** (called out in the codebase review) will trip
  any local Redis testing of snake. Out of scope for this plan; tracked
  separately.
- **Bot socket using `io('/')` directly** in clash's `GameScreen.jsx`
  (also flagged in review). Phase 3 will avoid repeating this for snake
  bots — they will go through the shared `socket.js` `SERVER_URL`.

## Open questions to confirm before Phase 2 starts

1. **Win condition**: time-out only, last-snake-standing only, or both
   (whichever happens first)? Default in plan: both.
2. **Respawn**: none (MVP), or auto-respawn after K seconds at a random
   safe spot? Default in plan: **no respawn** in MVP (death is terminal
   for the match).
3. **Match start**: auto-start when first player joins (current clash
   behaviour), or wait for a min player count + countdown? Default in
   plan: **auto-start, identical to clash**.
4. **Food count scaling**: fixed `FOOD_COUNT_TARGET = 30`, or scale with
   player count (`max(30, 5 × players)`)? Default: fixed.
5. **Naming**: ship as "Geo Snake" in UI, or pick something else? Default:
   "Geo Snake".

## Branching & commits

- New branch: `feature/geo-snake-game` off `main`.
- Atomic commits per numbered subtask above (Phase 1 produces ~7 commits,
  Phase 2 ~6, Phase 3 ~8).
- Conventional commits (`refactor:`, `feat(snake):`, `test(snake):`).
- Final review: present working build to user; on approval, delete this
  plan file, squash-merge into `main`, delete the branch.

## Out-of-scope follow-ups (future PRs)

- `GameMode` abstraction (informed by both implementations).
- Spatial hash for collisions if player counts grow.
- Tail-delta protocol (append/drop instead of full polyline).
- Snake-specific gestures (boost = swipe forward; turn = phone tilt).
- Power-ups (speed, ghost, magnet) — explicitly out of MVP.
- Team mode.
