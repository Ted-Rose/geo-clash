# Test Plan — Part D: client

**Part:** D — client
**Files reviewed (live):**
- `client/src/socket.js` (41 LOC)
- `client/src/hooks/useGeolocation.js` (53)
- `client/src/hooks/useRooms.js` (35)
- `client/src/hooks/useSound.js` (170)
- `client/src/App.jsx` (154)
- `client/src/components/{GameScreen,LobbyScreen,MapView,HUD,PostMatchScreen,ControlPanel,ProjectileLayer,SimPanel}.jsx`
- `client/src/snake/{GameScreen,HUD,SnakeLayer,FoodLayer}.jsx`

**Shims confirmed (no tests planned):** all of `client/src/clash/*.jsx`,
`client/src/shared/{socket.js,MapView.jsx,hooks/*}` are 1–2 line re-exports —
verified by reading them and by grep: nothing under `src/` imports from
`clash/` or `shared/`. `main.jsx` and `index.css` excluded.

**Existing tests accounted for:** none — the client has no runner, no test
deps, and no `*.test.*` files. Every proposal below is net-new coverage.

---

## Test setup (required before anything else)

The client is plain Vite + React 18, so the minimal stack is:

- **Deps** (devDependencies in `client/package.json`): `vitest`, `jsdom`,
  `@testing-library/react` (≥14 — includes `renderHook`, no separate hooks
  package needed), `@testing-library/user-event`,
  `@testing-library/jest-dom` (optional; nice matchers for the P2 render
  tests).
- **Config:** add a `test` block to `client/vite.config.js`
  (`environment: 'jsdom'`, `setupFiles: './src/test/setup.js'`) or a separate
  `vitest.config.js` that reuses the react plugin. Add
  `"test": "vitest run"` to `client/package.json`. `import.meta.env` works
  under vitest natively.
- **Socket mocking:** `vi.mock('socket.io-client', …)` returning a
  hand-rolled fake socket `{ id, connected, on/off/emit }` where `on` records
  handlers in a Map and a `socket._trigger(event, payload)` test helper fires
  them (mirrors the server-side `makeIoStub` convention). `emit` should
  accept an ack callback the test can invoke. Because `socket.js` keeps a
  module-level singleton, tests must `vi.resetModules()` + dynamic
  `await import('../socket.js')` per case.
- **Geolocation mocking:** stub `navigator.geolocation =
  { watchPosition: vi.fn(), clearWatch: vi.fn() }`; drive position updates by
  invoking the captured `watchPosition` success callback.
- **Leaflet:** do NOT render `MapContainer` in jsdom (needs real layout/tile
  loading). For the few component tests, `vi.mock('react-leaflet', …)` with
  passthrough stubs (`MapContainer → <div>`, `Marker/Polyline/Polygon → null`,
  `useMap → () => fakeMap`) and `vi.mock('leaflet', …)` returning
  `{ divIcon: vi.fn(() => ({})) }`.
- **Timers:** vitest fake timers (`vi.useFakeTimers()`) are fine here (unlike
  the server suite's no-fake-timers convention — that convention is for
  `node --test` interval loops, not React effects). Prefer driving effects
  via `act()` + firing captured callbacks where possible.

---

## Coverage gaps summary

- **`snake/GameScreen.jsx` is client-authoritative for tail + score** —
  `buildTail()` trimming (5 m tail per score point, 200-segment cap) and the
  optimistic `eat_food` path are game rules living on the client; a bug here
  desyncs every peer. Highest-risk untested code in scope.
- **`socket.js` session identity**: `getSessionId()` is the entire reconnect
  story (server keys `swapSocketId`/`getPlayerBySessionId` on it); a
  regression silently breaks rejoin-after-drop.
- **`useGeolocation` bearing fallback**: when `coords.heading` is absent the
  hook derives heading from movement deltas — real math, exercised on every
  desktop-sim/GPS-less run.
- **`useRooms` resilience**: malformed `rooms-updated` payloads and the
  `rooms-list` ack shape guard the lobby during reconnects.
- **`LobbyScreen` create/join emit payloads**: the `room-create` payload
  shape differs per `gameType` (clash ammo fields only when `ammoLimit > 0`;
  snake-only `foodCountTarget`/`arenaSideMeters`/`timeLimitMs`). Wrong
  payloads = rooms created with silently wrong rules.
- **Pure helpers buried in components**: `formatTime`/`useCountdown`
  (snake/HUD), `sampleEvenPoints`/`lightenHex`/`distM` (SnakeLayer),
  `distDeg`/`atBase` logic (clash GameScreen), `idToFreq` (useSound) — all
  module-private; see refactor notes.
- **`ControlPanel` shake detector**: 3-shakes-in-1200 ms → attack, with
  800 ms re-fire cooldown — timing logic easy to break.
- **`ProjectileLayer` interpolation**: t-lerp + expiry filter depend on
  `skewMs`-corrected server clock.

---

## Prioritized test list

### P0 — authoritative / identity / game-state logic

| # | Test name | File under test | Proposed test file | Type | Scenario + edge cases | Mocking/setup | Priority |
|---|-----------|-----------------|--------------------|------|------------------------|---------------|----------|
| 1 | `getSessionId returns the same id across calls and persists to sessionStorage` | `src/socket.js` | `src/test/socket.test.js` | unit | Call twice → identical UUID; assert `sessionStorage.getItem('geo-clash-session')` written once. Edge: pre-seeded sessionStorage → returns seed, does NOT call `crypto.randomUUID`. | jsdom sessionStorage (real); spy on `crypto.randomUUID`; `vi.resetModules` between cases. | P0 |
| 2 | `API_BASE is '' when SERVER_URL is '/', equals SERVER_URL when set` | `src/socket.js` | `src/test/socket.test.js` | unit | Re-import module with `VITE_SERVER_URL` unset → `SERVER_URL === '/'`, `API_BASE === ''`; with `VITE_SERVER_URL=https://x.example` → `API_BASE === 'https://x.example'`. | `vi.stubEnv('VITE_SERVER_URL', …)` + `vi.resetModules` + dynamic `await import`. | P0 |
| 3 | `getSocket returns a singleton and passes websocket+polling transports` | `src/socket.js` | `src/test/socket.test.js` | unit | Two calls → same object; `io` called once with `{ autoConnect: true, transports: ['websocket','polling'] }`. | `vi.mock('socket.io-client')` with `io` spy. | P0 |
| 4 | `useRooms seeds from rooms-list ack and updates on rooms-updated` | `src/hooks/useRooms.js` | `src/test/hooks/useRooms.test.js` | unit | Mount with `connected: true` → emits `rooms-list`; invoke ack cb `{rooms:[…]}` → `rooms` set, `loading` false. Then `_trigger('rooms-updated', {rooms:[…]})` replaces list. Edge: non-array `rooms` in push/ack ignored; ack without `.rooms` still clears `loading`. | renderHook; `vi.mock('../socket.js')` → `getSocket` returns fake socket; `emit` captures ack cb. | P0 |
| 5 | `useRooms refreshes on connect event and unsubscribes on unmount` | `src/hooks/useRooms.js` | `src/test/hooks/useRooms.test.js` | unit | Mount with `connected: false` → no `rooms-list` emitted; `_trigger('connect')` → emits it. Unmount → `off` called for `rooms-updated` and `connect`. | same fake socket; track `emit`/`off` calls. | P0 |
| 6 | `useGeolocation returns simulated position and never touches GPS` | `src/hooks/useGeolocation.js` | `src/test/hooks/useGeolocation.test.js` | unit | `renderHook(() => useGeolocation({simulated: pos}))` → `position` equals `pos`; `watchPosition` never called. | stub `navigator.geolocation` spies. | P0 |
| 7 | `useGeolocation derives heading via bearing when coords.heading is null` | `src/hooks/useGeolocation.js` | `src/test/hooks/useGeolocation.test.js` | unit | Fire watchPosition success twice: A then B due north of A with `heading: NaN` → second position.heading ≈ 0 (±ε); east ≈ 90. First fix (no lastPos) → `heading: null`. `coords.heading` finite → passed through, no fallback. | stub `watchPosition` to capture cb, invoke manually inside `act()`. Needs `bearing` exported OR test through hook (preferred — see refactor note 1). | P0 |
| 8 | `useGeolocation reports unsupported and clears watch on unmount` | `src/hooks/useGeolocation.js` | `src/test/hooks/useGeolocation.test.js` | unit | Delete `navigator.geolocation` → `error === 'Geolocation not supported'`. With watch: unmount → `clearWatch(id)` called; `enabled:false` → no watch. | same stubs. | P0 |
| 9 | `buildTail trims to score*5 m and caps at 200 segments` | `src/snake/GameScreen.jsx` | `src/test/snake/tail.test.js` | unit | Feed a straight-line tail longer than `score*5` → trimmed from the front (oldest first), length ≤ maxLen. Edge: `score=0` → `[]`; >200 segments → last 200 kept; input order oldest→newest preserved. | Needs `buildTail`/`distanceMeters` exported (refactor note 2). Pure — no mocks. | P0 |
| 10 | `distanceMeters matches known haversine distances` | `src/snake/GameScreen.jsx` | `src/test/snake/geo.test.js` | unit | Same point → 0; ~111.32 km per degree of latitude at equator; symmetric `d(a,b)===d(b,a)`. | same export need; pure. | P0 |
| 11 | `snake position effect: eats food within 4 m once, emits eat_food + location-update with tail/score` | `src/snake/GameScreen.jsx` | `src/test/snake/GameScreen.test.jsx` | integration | Render with `position` near a seeded food (post-grace — set spawn ref back via prop or fake timers), food → `eat_food` emitted with that `foodId`, score incremented, second render same food → no duplicate `eat_food`. Then `food-update` push clears `eatenIds` → re-eat allowed. | render component with `vi.mock('react-leaflet')`, `vi.mock('../socket.js')` fake socket; `vi.mock('../hooks/useSound.js')` no-op; fake `Date.now` to pass `SPAWN_GRACE_MS`. | P0 |
| 12 | `clash_verify event emits clash_ack with the same clashId; non-string ignored` | `src/snake/GameScreen.jsx` | `src/test/snake/GameScreen.test.jsx` | integration | `_trigger('clash_verify', {clashId:'c1'})` → `socket.emit('clash_ack', {clashId:'c1'})`; `{clashId: 5}` → no emit. | same mocks. | P0 |
| 13 | `snake-reset wipes local tail/score only for the local player` | `src/snake/GameScreen.jsx` | `src/test/snake/GameScreen.test.jsx` | integration | Build up local tail/score via position updates; `_trigger('snake-reset', {playerId: myId})` → subsequent `location-update` carries `score: 0, tailPoints: []`; `{playerId: 'other'}` → state kept. | same mocks. | P0 |

### P1 — lobby validation + derived state

| # | Test name | File under test | Proposed test file | Type | Scenario + edge cases | Mocking/setup | Priority |
|---|-----------|-----------------|--------------------|------|------------------------|---------------|----------|
| 14 | `room-create emits clash payload with ammo fields only when ammoLimit > 0` | `src/components/LobbyScreen.jsx` | `src/test/components/LobbyScreen.test.jsx` | component | Render with `connected`, `position`, `simulate` props; pick clash, set ammo 3 → emit payload contains `maxAmmo: 3, ammoRenewalMs` and no snake keys; ammo ∞ (0) → neither ammo key present. Edge: snake selected → payload has `foodCountTarget`, `foodRespawnIntervalMs`, `arenaSideMeters`, `timeLimitMs` and no clash keys. | `vi.mock('../../socket.js')` + `vi.mock('../../hooks/useRooms.js')` returning `{rooms:[],loading:false,refresh}`; `userEvent` clicks; capture `emit('room-create', payload, cb)`. | P1 |
| 15 | `joinRoom disabled until position+connected; on ack failure sets error and refreshes on no-such-room/ended` | `src/components/LobbyScreen.jsx` | `src/test/components/LobbyScreen.test.jsx` | component | `position:null` → join button disabled, `room-join` never emitted. With position: ack `{ok:false, reason:'no-such-room'}` → error text shown + `refresh()` called; reason `'other'` → error shown, no refresh. Ack `{ok:true}` → `onJoined` called with roomId, snapshot, trimmed name (empty name → `undefined`). | same mocks; ack cb invoked by test. | P1 |
| 16 | `create → join auto-flow: room-join emitted with ack.room.id after create ok` | `src/components/LobbyScreen.jsx` | `src/test/components/LobbyScreen.test.jsx` | component | Create ack `{ok:true, room:{id:'r1'}}` → `room-join` emitted with `roomId:'r1'`, lat/lng from `position`, `sessionId` from getSessionId; join-ack fail → error shown, `onJoined` NOT called; create-ack fail → no `room-join` emit. | same + `getSessionId` mocked to fixed value. | P1 |
| 17 | `sortedRooms lists newest createdAt first; full/ended rooms render disabled` | `src/components/LobbyScreen.jsx` | `src/test/components/LobbyScreen.test.jsx` | component | `useRooms` returns 3 rooms unsorted → rendered order is desc by `createdAt`; room with `playerCount===maxPlayers` and room with `status:'ended'` have disabled join buttons. | `useRooms` mock returning fixed rooms; DOM order via RTL queries. | P1 |
| 18 | `useCountdown returns null without timeLimitMs and counts down from matchStartAt` | `src/snake/HUD.jsx` | `src/test/snake/HUD.test.jsx` | unit | `renderHook` (after export) or render `<SnakeHUD>`: `timeLimitMs=0` → no Time box; `timeLimitMs=60_000, matchStartAt=now-30_000` → remaining ≈ 30 s; already-past start → clamps to 0, formatted `0:00`. | fake `Date.now` or `vi.useFakeTimers`; export `useCountdown`/`formatTime` (refactor note 3). | P1 |
| 19 | `formatTime renders m:ss with ceil rounding` | `src/snake/HUD.jsx` | `src/test/snake/HUD.test.jsx` | unit | `formatTime(0)==='0:00'`, `formatTime(61000)==='1:01'`, `formatTime(59900)==='1:00'` (ceil), `formatTime(30*60*1000)==='30:00'`. | pure export needed (refactor note 3). | P1 |
| 20 | `sampleEvenPoints spaces markers evenly along a multi-segment path` | `src/snake/SnakeLayer.jsx` | `src/test/snake/SnakeLayer.test.js` | unit | L-shaped path, count=5 → consecutive output points within ~equal arc distance; endpoints land on path. Edge: empty path/count 0 → `[]`; single point → `[point]`; count=1 → returns one point; zero-length path → `[path[0]]`. | export `sampleEvenPoints` (+`distM`) (refactor note 4); pure. | P1 |
| 21 | `lightenHex blends toward white at amount 0.45` | `src/snake/SnakeLayer.jsx` | `src/test/snake/SnakeLayer.test.js` | unit | `#000000` → `rgb(115,115,115)`; `#ff0000` → `rgb(255,115,115)`; already-white stays white. | same export; pure. | P2 (nice math, low risk) |
| 22 | `clash GameScreen: grid-update merges cells by id and keeps prior ownership` | `src/components/GameScreen.jsx` | `src/test/components/GameScreen.test.jsx` | integration | Seed ownership via `initialSnapshot`; `_trigger('grid-update', {cells:[one changed cell]})` → HUD/square count reflects merge, unchanged cells retained; `scores` in payload updates leaderboard. | `vi.mock('../../socket.js')`, `vi.mock('react-leaflet')`, `vi.mock('./MapView.jsx')` passthrough capturing props, `vi.mock('../hooks/useSound.js')`. | P1 |
| 23 | `clash GameScreen: location-update throttled to ≥250 ms and carries heading default 0` | `src/components/GameScreen.jsx` | `src/test/components/GameScreen.test.jsx` | integration | Two rapid position prop changes → single `location-update` emit; `position.heading` undefined → emits `heading: 0`. | fake timers or manual `Date.now` spy; same mocks. | P1 |
| 24 | `clash GameScreen: snapshot/time-sync compute skew; match-end fetches global leaderboard` | `src/components/GameScreen.jsx` | `src/test/components/GameScreen.test.jsx` | integration | `time-sync` ack `{serverNowMs}` → `skewMs` ≈ serverNow − midpoint (verify via ProjectileLayer props). `match-end` → `fetch('${API_BASE}/api/leaderboard?limit=10')` called; non-ok resp → `globalTop` `[]`. | same mocks + `globalThis.fetch` stub; capture MapView/ProjectileLayer props via mocked components. | P1 |
| 25 | `App: persists maxImageryAge/maxNativeZoom to localStorage, defaults 3/18` | `src/App.jsx` | `src/test/App.test.jsx` | component | Fresh storage → LobbyScreen receives 3 and 18; setter writes `localStorage` and re-renders. Pre-seeded `'7'`/`'16'` parsed via `parseInt`. | `vi.mock('./socket.js')` (fake socket `connected:false`), `vi.mock` LobbyScreen to capture props (avoid rendering the whole lobby). | P1 |
| 26 | `App: reconnect re-emits room-join with saved sessionId; failed ack returns to lobby` | `src/App.jsx` | `src/test/App.test.jsx` | integration | After `onJoined` establishes `rejoinRef`, `_trigger('connect')` → `room-join` emitted with `{roomId,name,sessionId}`; ack `{ok:false}` → lobby rendered again; `{ok:true,snapshot}` → `reconnectSnap` flows to GameScreen. | fake socket + mocked Lobby/GameScreens capturing props. | P1 |
| 27 | `ControlPanel shake detector: 3 motions >22 mag within 1200 ms fires onAttack once, 800 ms cooldown` | `src/components/ControlPanel.jsx` | `src/test/components/ControlPanel.test.jsx` | component | Dispatch `devicemotion` events (`accelerationIncludingGravity {x:25,y:0,z:0}`) ×3 within window → `onAttack` once; a 4th within 800 ms → still once; spaced >1200 ms → no fire; mag ≤22 ignored. | jsdom `window.dispatchEvent(new Event('devicemotion'))` with assigned props; fake `Date.now` or fake timers. | P1 |

### P2 — rendering & nice-to-have

| # | Test name | File under test | Proposed test file | Type | Scenario + edge cases | Mocking/setup | Priority |
|---|-----------|-----------------|--------------------|------|------------------------|---------------|----------|
| 28 | `clash HUD formats mm:ss, hearts by lives, rockets by ammo, top-4 leaderboard` | `src/components/HUD.jsx` | `src/test/components/HUD.test.jsx` | component | `remainingSeconds=95` → `1:35`; `lives=2` → 2❤️1🖤; `ammo=1,maxAmmo=3` → 1🚀2○; 5-row leaderboard → renders 4; `remainingSeconds` undefined → `0:00`. | none — pure render. | P2 |
| 29 | `ControlPanel shows RESPAWN when lives ≤0, gated on atBase; shield countdown ticks` | `src/components/ControlPanel.jsx` | `src/test/components/ControlPanel.test.jsx` | component | `me.lives=0, atBase=false` → 'GO TO BASE' disabled; `atBase=true` → RESPAWN calls `onRespawn`. `shieldUntil=now+2000` → badge shows ~2.0 s and SHIELD disabled; `outOfAmmo` disables FIRE. | fake timers for the 100 ms interval. | P2 |
| 30 | `SimPanel WASD nudges simPos by step and sets cardinal heading` | `src/components/SimPanel.jsx` | `src/test/components/SimPanel.test.jsx` | component | `simPos` set → `keydown 'w'` → `setSimPos` called with `lat+step, heading:0`; `'d'` → `lng+step, heading:90`; unmapped key ignored; `simPos=null` → no-op (early return). | `window.dispatchEvent(new KeyboardEvent('keydown',{key:'w'}))`; `setSimPos` spy. | P2 |
| 31 | `PostMatchScreen shows winner, match table, and three globalTop states` | `src/components/PostMatchScreen.jsx` | `src/test/components/PostMatchScreen.test.jsx` | component | `globalTop=null` → 'Loading…'; `[]` → 'No scores archived yet'; rows → `squaresCaptured ?? squares` fallback rendering; `finalLeaderboard` undefined → no crash. | none — pure render. | P2 |
| 32 | `ProjectileLayer prunes expired and not-yet-spawned projectiles, lerps position` | `src/components/ProjectileLayer.jsx` | `src/test/components/ProjectileLayer.test.jsx` | component | `tArrival < now+skew` → not rendered; `tSpawn > now+500` → not rendered; mid-flight → Marker position ≈ linear lerp; heading ≈ `atan2(dLng,dLat)` deg. | `vi.mock('react-leaflet')` capture `Marker.position`/`Polyline.positions`; `vi.mock('leaflet')`; stub `Date.now`; rAF → manual stub or let it tick once. | P2 |
| 33 | `idToFreq maps ids deterministically into [min,max)` | `src/hooks/useSound.js` | `src/test/hooks/useSound.test.js` | unit | Same id → same freq; `''` → `min`; distinct ids → distinct-ish freqs within `[320,720)`; non-negative. | export `idToFreq` (refactor note 5); pure — do NOT test WebAudio playback paths. | P2 |
| 34 | `snake GameScreen WASD sim movement updates simPos` | `src/snake/GameScreen.jsx` | `src/test/snake/GameScreen.test.jsx` | component | `simulate && simPos` → `keydown 'a'` → `setSimPos` decrements `lng` by step. Edge: `simulate=false` → no listener effect. | same snake-screen mocks. | P2 |
| 35 | `LobbyScreen seeds default simPos once when simulate toggled on` | `src/components/LobbyScreen.jsx` | `src/test/components/LobbyScreen.test.jsx` | component | `simulate=true, simPos=null` → `setSimPos` called once with the Berlin seed `{lat:52.5163,lng:13.3777,heading:0}`; existing `simPos` → not overwritten. | same lobby mocks. | P2 |

**Explicitly skipped:**
- `MapView.jsx` — pure Leaflet/DOM glue; would need a real map renderer. No
  testable logic beyond icon-SVG string building (cosmetic).
- `FoodLayer.jsx`, icon builders (`playerIcon`, `rocketIcon`,
  `makeSnakeHeadIcon`, `makeFoodIcon`) — SVG string concatenation; assert
  only if a regression hunt specifically needs it (not planned).
- `useSound.js` playback functions — WebAudio; only `idToFreq` is testable
  (row 33).
- Re-export shims under `clash/` and `shared/` — no logic.

---

## Refactor-for-testability notes

1. **`useGeolocation.js`** — `bearing()` is module-private. Prefer testing
   through the hook (row 7); alternatively `export function bearing` — one
   keyword, no API risk since the hook already re-exports cleanly.
2. **`snake/GameScreen.jsx`** — `distanceMeters` and `buildTail` are
   module-private *and* client-authoritative. Move them (plus the constants
   `TAIL_METERS_PER_SCORE`, `MAX_TAIL_SEGMENTS`, `MIN_MOVE_M`, `EAT_RADIUS_M`)
   into `src/snake/geo.js` and import — mirrors `server/src/snake/` splitting
   pure math from the screen. Also dedupes with `SnakeLayer`'s own `distM`.
3. **`snake/HUD.jsx`** — `export` `useCountdown` and `formatTime` (or move
   `formatTime` to a shared `src/timeUtils.js`; clash `HUD.jsx` inlines the
   same mm:ss formatting).
4. **`snake/SnakeLayer.jsx`** — `export` `sampleEvenPoints`, `distM`,
   `lightenHex` (or move to `src/snake/geo.js` alongside note 2).
5. **`useSound.js`** — `export` `idToFreq` only; leave players private.
6. **`components/GameScreen.jsx`** — `distDeg` + `ENEMY_SHOT_NEAR_DEG` and
   the `atBase` bbox check are testable pure logic; optional extract to a
   small helpers module. Lower priority — covered indirectly via row 22.
7. **`socket.js`** — `getSessionId`/`API_BASE` are already exported; only
   `vi.resetModules` + `vi.stubEnv` needed, no source changes. Consider
   exporting a `__resetSocketForTests` or leaving as-is (resetModules is
   sufficient).
