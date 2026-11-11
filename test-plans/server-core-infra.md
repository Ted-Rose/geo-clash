# Test Implementation Plan — Part A: server-core-infra

**Files reviewed** (all under `server/src/`):
`index.js`, `socketHandlers.js` (top-level lobby/lifecycle dispatcher),
`roomRegistry.js`, `tileProxy.js`, `shared/gridUtils.js`,
`shared/memoryStore.js`, `shared/valkeyStore.js`, `shared/roomLock.js`,
`shared/timeSync.js`.

**Shim files confirmed — no tests planned:** `src/gameState.js`,
`src/projectiles.js`, `src/gridUtils.js`, `src/memoryStore.js`,
`src/roomLock.js`, `src/valkeyStore.js` are 2–13-line re-export shims.

**Existing tests accounted for:**
- `test/roomRegistry.test.js` — create×50 uniqueness, join capacity
  (`room-full`), unknown gameType reject, snake create, destroy-from-list.
- `test/cleanup.test.js` — endMatch→leaderboard archive, last-leave→destroy,
  match-end leaderboard payload.
- `test/memoryStore.test.js` — `makeRoomStores` independence,
  `MemoryLeaderboardStore` sort/cap, `leaderboardStore` smoke.
- `test/leaderboard.test.js` — `top()` gameType filter, `squaresCaptured` alias.
- `test/roomLock.test.js` — local serialize, release-on-throw, Redis NX/PX
  acquire + CAS release, stolen-lock CAS, `LockTimeoutError`.
- `test/valkeyZSet.test.js` — `ValkeyZSetStore` add/topRev/trimToCap/addMany.

None of the proposed cases below duplicate these.

---

## Coverage gaps summary

- **Reconnect path is completely untested** — `join()`'s sessionId branch
  (`getPlayerBySessionId` → `swapSocketId` → `reconnected:true` →
  `player-reconnected` broadcast → pending-disconnect-timer cancel). This is
  the highest-risk logic in the file: a wrong swap leaks player records keyed
  to dead socket ids and rewrites cell ownership.
- **`softDisconnect()` untested** — `connected=false` marking,
  `player-disconnected` broadcast, grace-period computation
  (`remainingSeconds*1000 + 30_000` vs flat `30_000`), timer→`leave()`→room
  destroy, and the player-not-found hard-leave fallback.
- **Top-level `socketHandlers.js` untested** — the whole lobby contract
  (`rooms-updated`, `rooms-list`, `room-create`, `room-join`, `room-leave`,
  `disconnect`, `time-sync`) plus gameType dispatch to clash vs snake
  gameplay handlers.
- **`index.js` REST + CORS untested** — `/health`, `/api/rooms` GET/POST,
  `/api/leaderboard` limit clamping (1–100, default 25), `parseCorsOrigin`.
  Blocked by entrypoint auto-listen (see refactor notes).
- **`tileProxy.js` untested** — imagery-age 404 enforcement, metadata cache,
  upstream error mapping (status passthrough / 502), `tileToBBox` math.
- **`ValkeyStore` and `ValkeyLeaderboardStore` untested** — only the ZSET
  half of `valkeyStore.js` is covered.
- **`shared/gridUtils.js` untested** — pure geo math; cheap to cover.
- **`init()`, `list()` ordering, `_broadcastList`, meta shapes, `destroy()`
  socket eviction untested** in `roomRegistry.js`.

### Review observations (not test tasks — flag to maintainer)

- `EMPTY_ROOM_TTL_MS` and `_destroyTimers` are **dead code**: nothing ever
  calls `this._destroyTimers.set(...)`. `join()`/`destroy()` clear timers
  that are never scheduled. Either wire up the empty-room TTL or delete.
- `leave()` and `destroy()` never clear per-socket `_disconnectTimers`
  entries. Timers are `unref`'d so they're harmless, but a pending timer
  fires `leave()` on a destroyed room (early-returns safely today).
- `SnakeGameState` has no `getPlayerBySessionId`/`swapSocketId`, so a snake
  player who disconnects and rejoins with a `sessionId` falls through to
  normal `addPlayer` (and gets `room-full` at capacity). Reconnect is
  clash-only; probably fine for MVP but worth pinning in a test.
- `shared/memoryStore.js` reads `VALKEY_URL` at module load and
  `lazyConnect:false` means `new Redis(...)` dials immediately — testing the
  Redis branch needs a dynamic import + env dance (see notes).
- `ValkeyStore.clear()` calls `client.del(arrayOfKeys)` while
  `ValkeyLeaderboardStore.clear()` uses `client.del(...keys)`. ioredis
  flattens array args so both work in prod, but fakes must tolerate arrays.
- `ValkeyStore.size()` is hardcoded `0` — intentional-looking (avoids
  `KEYS` cost); assert it, don't "fix" it.
- `softDisconnect()` on a snake room always uses 30 s grace because
  `SnakeGameState` has no `remainingSeconds` field — appears intended.
- Non-reconnect `join()` calls `socket.join(roomId)` without `await`
  (line 206) — harmless for fake sockets, noted for completeness.

---

## Prioritized test list

Mocking conventions (match existing tests exactly):
- `makeIoStub()` — `{_events:[], _rooms:Map, to(id)→{emit}, in(id)→{fetchSockets}, emit}`.
- `fakeSocket(id)` — `{id, data:{}, join(){}, leave(){}}`. For dispatcher
  tests, extend it: `_handlers` map populated by `on(ev, cb)`, `_emitted`
  array populated by `emit(ev, p)`, and an `await trigger(ev, ...args)`
  helper that invokes and awaits the registered handler.
- Fake Redis clients implement only exercised ioredis methods
  (`FakeZRedis` in `valkeyZSet.test.js` is the model).
- Private-field seeding is an accepted convention (`reg._index._local`,
  `reg._metaStore`, `game.remainingSeconds`, `game._bbox`).
- `t.after(() => reg.destroy(room.id))` / `game.endMatch()` cleanup.
- Timer-dependent tests use **`mock.timers` from `node:test`**
  (`mock.timers.enable({ apis: ['setTimeout', 'Date'] })`,
  `mock.timers.tick(ms)`, `mock.timers.reset()` in `t.after`). Requires
  Node ≥ 20.4 — Dockerfile is `node:20-alpine` so it works, but it is
  experimental; keep `setImmediate`/`queueMicrotask` unmocked so async
  continuations still flush, and `await` a microtask/real tick after
  `mock.timers.tick()` since timer callbacks are async. Alternative is an
  injectable grace period (see refactor notes) — prefer `mock.timers` since
  it needs zero source churn.

### `server/test/reconnect.test.js` — registry session-reconnect flow

| # | Test name | Type | Priority |
|---|-----------|------|----------|
| R1 | `join with matching sessionId reconnects and swaps socketId` | integration | **P0** |
| R2 | `reconnect cancels pending disconnect timer` | integration | **P0** |
| R3 | `reconnect while player still connected takes over the session` | integration | P1 |
| R4 | `snake room ignores sessionId — no reconnect support` | integration | P1 |
| R5 | `join rejects no-such-room and ended rooms` | unit/integration | P1 |

**R1** — Arrange: `reg.create` clash room, `join` socket `s1` with
`sessionId:'sess-1'`. Act: `join` socket `s2` with same `sessionId`. Assert:
`result.reconnected === true`; `playerStore` now keyed by `s2` (old `s1`
entry gone); `io._events` has `{scope:roomId, event:'player-reconnected',
payload:{id:'s2', oldId:'s1'}}`; `s2` emitted `joined` + `snapshot`;
`meta.playerCount` still 1; `socket.data.gameType === 'clash'` and clash
gameplay handlers re-registered on `s2`. Setup: `makeIoStub`, fake sockets
with `_emitted`/`_handlers`, `t.after` destroy.

**R2** — Arrange: join `s1` w/ sessionId → `reg.softDisconnect(room, s1)`
(assert `_disconnectTimers.has('s1')`). Act: `join` `s2` same sessionId.
Assert: `_disconnectTimers` empty; `reconnected:true`; player record
`connected === true`; advancing `mock.timers` past the grace period does
NOT remove the player (timer was cleared — guards against zombie-leave).

**R3** — Arrange: join `s1` w/ sessionId, still connected (no
softDisconnect). Act: `join` `s2` same sessionId. Assert: swap still
happens (`reconnected:true`, `s1` playerStore entry deleted). Pins the
"session takeover" behavior — no disconnect required.

**R4** — Arrange: `reg.create({gameType:'snake'})`, join `s1` w/
`sessionId`. `softDisconnect(room, s1)`. Act: `join` `s2` same sessionId.
Assert: NOT `reconnected` — a second player was added (`meta.playerCount`
2) because `SnakeGameState` lacks `getPlayerBySessionId`. Edge: at
`maxPlayers` capacity the same call returns `room-full`. Pins clash-only
reconnect as documented behavior (see observations).

**R5** — `reg.join('nope', sock)` → `{ok:false, reason:'no-such-room'}`.
Seed `reg._metaStore` entry with `status:'ended'` (game exists in
`_rooms`) → join → `{ok:false, reason:'ended'}`.

### `server/test/softDisconnect.test.js` — disconnect lifecycle

| # | Test name | Type | Priority |
|---|-----------|------|----------|
| S1 | `softDisconnect marks connected=false and broadcasts player-disconnected` | integration | **P0** |
| S2 | `disconnect grace expiry removes player and destroys empty room` | integration | **P0** |
| S3 | `grace period extends to remainingSeconds + 30s while match active` | integration | P1 |
| S4 | `softDisconnect falls back to hard leave when player record missing` | integration | P1 |
| S5 | `pending disconnect timer after destroy() fires harmlessly` | integration | P1 |
| S6 | `destroy() evicts room sockets and clears socket.data.roomId` | integration | P1 |

**S1** — join → `softDisconnect`. Assert: `playerStore.get(id).connected ===
false`; `player-disconnected` emitted to room scope with `{id}`;
`socket.data.roomId === null`; `_disconnectTimers.has(id)`;
`meta.playerCount` still 1 (grace hasn't run).

**S2** — continue S1 on an inactive (lobby) room → `mock.timers.
tick(31_000)` + flush → `player-left` broadcast, `playerStore` empty,
`reg.get(roomId) === null`, `list()` empty. Verifies timer→`leave()`→
auto-destroy chain end-to-end.

**S3** — `game.startMatch()`; set `game.remainingSeconds = 10`;
`softDisconnect`. Assert: `tick(30_001)` → player still present;
`tick(10_000)` → removed (grace = 10 s remaining + 30 s = 40 s). Edge:
snake room (no `remainingSeconds`) → flat 30 s.

**S4** — join, then `await game.playerStore.del(id)` (simulates record
purged, e.g. post-match) → `softDisconnect`. Assert: immediate
`player-left` broadcast (not `player-disconnected`), `playerCount`
decremented, room destroyed at 0, NO entry in `_disconnectTimers`.

**S5** — `softDisconnect` (timer pending) → `reg.destroy(roomId)` →
`tick(60_000)` + flush. Assert: no throw, no `player-left`, no events —
`leave()` early-returns on missing game. Pins the leaked-timer behavior
(see observations).

**S6** — fake sockets' `join()`/`leave()` maintain `io._rooms` membership
(extend stub minimally). Two players in room → `destroy` → each socket's
`leave` called, `data.roomId === null`. Edge: make `fetchSockets` reject →
`destroy` still resolves and logs (P2 edge within the same test via a
second room).

### `server/test/registryMeta.test.js` — registry init/list/meta/broadcast

| # | Test name | Type | Priority |
|---|-----------|------|----------|
| M1 | `init() purges stale index + meta entries` | unit | P1 |
| M2 | `list() sorts by createdAt desc and tracks playerCount` | unit | P1 |
| M3 | `create() meta shape: default name, null center, per-gameType fields` | unit | P1 |
| M4 | `_broadcastList emits rooms-updated with current metas` | integration | P1 |
| M5 | `create() calls initGrid when numeric center provided` | integration | P2 |
| M6 | `destroy() is idempotent and safe on re-entry` | integration | P2 |

**M1** — `reg._index._local.add('stale-id')` +
`reg._metaStore.set('stale-id', {...})` → `await reg.init()` →
`list()` empty, `get('stale-id')` meta undefined. (Rehydration-purge path.)

**M2** — `new RoomRegistry(io, { now: () => t_ms })` — create r1@100,
r2@200 → `list()[0].id === r2.id`. join/leave → `playerCount` 0→1→0.

**M3** — no `name` → `Room-${id.slice(-4)}`; non-number `centerLat` →
`null`; snake meta gains `foodCountTarget:10`,
`foodRespawnIntervalMs:2000`, `arenaSideMeters:1000`, `timeLimitMs:0`
defaults; clash meta gains `maxAmmo`/`ammoRenewalMs` only when `maxAmmo
!== null` (assert key absent otherwise).

**M4** — after create+join, last `{scope:'*', event:'rooms-updated'}`
payload's `rooms` array contains the room meta with `playerCount:1`.

**M5** — `create({centerLat:51.5, centerLng:-0.12})` → `reg.get(id).grid`
non-null; without center → `grid` null (clash).

**M6** — `destroy` twice + `destroy` after `game.endMatch()` already ran
(re-entrancy via `onEnd`) → resolves, room absent. (`endMatch`→`onEnd`→
`destroy` loop already exercised in cleanup tests; this pins the
status-`ended` skip branch.)

### `server/test/lobbyHandlers.test.js` — top-level socketHandlers (socket-level)

Setup: fake `io` that captures the `connection` callback
(`on(ev,cb){ if(ev==='connection') this._conn = cb; }` plus the usual
`to/in/emit`), real `RoomRegistry`, and the extended `fakeSocket` with
`_handlers`/`_emitted`/`trigger()`. Call `registerSocketHandlers(io, reg)`
then `await io._conn(sock)` and drive events via `await sock.trigger(...)`.

| # | Test name | Type | Priority |
|---|-----------|------|----------|
| L1 | `connection emits rooms-updated and registers time-sync` | socket-level | P1 |
| L2 | `rooms-list ack returns rooms; missing ack tolerated` | socket-level | P1 |
| L3 | `room-create acks ok with defaults; bad gameType acks fail` | socket-level | P1 |
| L4 | `room-join without roomId acks no-room-id` | socket-level | P1 |
| L5 | `room-join happy path: joined+snapshot emits, player-joined broadcast, clash handlers` | socket-level | **P0** |
| L6 | `room-join snake room registers snake handlers` | socket-level | P1 |
| L7 | `room-join with non-numeric lat/lng still joins` | socket-level | P1 |
| L8 | `room-join reconnect path returns reconnected and skips re-broadcast` | socket-level | P1 |
| L9 | `room-leave delegates to registry.leave` | socket-level | P1 |
| L10 | `disconnect softDisconnects; disconnect outside a room is a no-op` | socket-level | **P0** |

**L1** — `await io._conn(sock)` → `sock._emitted` contains `rooms-updated`
with `{rooms:[]}`; `_handlers` includes `time-sync`, `rooms-list`,
`room-create`, `room-join`, `room-leave`, `disconnect`;
`sock.data.roomId === null`.

**L2** — `trigger('rooms-list', ackFn)` → ack called `{rooms:[...]}`;
`trigger('rooms-list')` (no ack) resolves without throw.

**L3** — `trigger('room-create', {name:'x'}, ack)` → `{ok:true, room}`
with `gameType:'clash'`; `{gameType:'snake'}` → snake meta;
`{gameType:'bogus'}` → `{ok:false, reason:'unsupported-game-type:bogus'}`;
no ack → tolerated. Also assert defaults forwarded: `timeLimitMs:0`,
`maxAmmo:null` land in meta per M3 rules.

**L4** — `trigger('room-join', {}, ack)` → `{ok:false,
reason:'no-room-id'}`; `trigger('room-join', null, ack)` same.

**L5** — create clash room via L3 or `reg.create` directly; `trigger
('room-join', {roomId, name:'A', lat:51.5, lng:-0.12}, ack)` → `ack.ok`;
`sock._emitted` has `joined` `{id, roomId}` then `snapshot`;
`io.to(roomId)` got `player-joined` `{id: sock.id}`;
`sock.data.roomId === roomId`, `data.gameType === 'clash'`; `_handlers`
gained `location-update`, `player-attack`, `player-shield`,
`player-respawn`; with numeric lat/lng `ensureGridFromPlayer` ran
(`game.grid` non-null) and `updateLocation` applied (player in snapshot
has lat 51.5). **Edge:** joining a snake room at L6.

**L6** — same as L5 on a snake room → `data.gameType === 'snake'`,
handlers are `location-update`, `eat_food`, `clash_ack` (and NOT
`player-attack`).

**L7** — join without `lat`/`lng` (or `lat:'x'`) → `ack.ok` true, snapshot
present from registry, `ensureGridFromPlayer` not invoked (grid stays
null for a center-less clash room).

**L8** — covers the handler's `!result.reconnected` guard: join `s1` w/
sessionId → `trigger('disconnect')` on s1 → `trigger('room-join',
{roomId, sessionId}, ack)` on `s2` → `ack.reconnected === true`;
`player-reconnected` broadcast; NO `player-joined` and NO second `joined`
emit from the handler (registry emitted them).

**L9** — after joining, `trigger('room-leave')` → `player-left` broadcast,
`sock.data.roomId === null`, `meta.playerCount` decremented.

**L10** — after joining, `trigger('disconnect')` → `player-disconnected`
broadcast + `_disconnectTimers` entry (mirrors S1 via the socket path).
Fresh socket never joined → `trigger('disconnect')` resolves, zero emits.

### `server/test/tileProxy.test.js` — HTTP integration against express router

Setup: `express()` + `app.use('/t', tileProxy)` + `listen(0)`; real
`fetch` to `127.0.0.1`. Stub `globalThis.fetch` to dispatch by URL —
requests to `127.0.0.1`/`localhost` pass through to the **saved original
fetch**, `arcgisonline.com/.../query` → canned metadata `Response`,
`.../tile/...` → canned bytes/status/throw. Restore in `t.after`; close
the server.

| # | Test name | Type | Priority |
|---|-----------|------|----------|
| T1 | `fresh imagery proxies tile with upstream headers` | integration | P1 |
| T2 | `imagery older than maxAge returns 404 and skips tile fetch` | integration | P1 |
| T3 | `maxAge query param adjusts cutoff; invalid value uses default 3` | integration | P2 |
| T4 | `missing or failed metadata proxies the tile through` | integration | P1 |
| T5 | `upstream tile non-OK forwards its status` | integration | P1 |
| T6 | `upstream tile fetch throwing yields 502` | integration | P1 |
| T7 | `metadata cache dedupes repeat requests and expires after TTL` | integration | P2 |
| T8 | `tileToBBox produces correct envelope (via geometry param)` | unit/integration | P2 |

**T1** — metadata returns `features:[{attributes:{src_date: <now - 1y>}}]`;
tile fetch returns `Response(Uint8Array, {headers:{'Content-Type':
'image/png'}})` → expect 200, `Content-Type: image/png`,
`Cache-Control: public, max-age=86400`, body bytes equal.

**T2** — `src_date` = now−5y, default maxAge=3 → 404 `"Imagery too old"`;
assert the tile-fetch branch of the stub was never called (count calls).

**T3** — same 5y-old src_date with `?maxAge=10` → 200 proxied;
`?maxAge=abc` → default 3 → 404; `?maxAge=0` → falsy → default 3 → 404.

**T4** — three sub-cases (can be one test each or a table): metadata fetch
throws → proxy; `{features:[]}` → proxy; metadata 500 non-JSON →
`response.json()` throws → proxy. All → 200.

**T5** — metadata fresh; tile fetch → `Response('x', {status:503})` →
response 503.

**T6** — tile fetch `reject`/`throw` → 502 `{error:'Source fetch failed'}`.

**T7** — GET same `z/y/x` twice → metadata fetch count 1, tile fetch
count 2; different tile → metadata count 2. TTL: `mock.timers.enable
({apis:['Date','setTimeout']})`, `tick(3_601_000)` (> CACHE_TTL 1 h) →
third request refetches metadata (count 2). Caveat: `metadataCache` is a
module singleton shared across tests in the file — use unique tile coords
per test to isolate, or note that cache-hit across tests is acceptable
since assertions count fetches per test.

**T8** — capture the `geometry` param from the mocked metadata URL:
`z=0,x=0,y=0` → `west=-180, east=180, north≈85.05, south≈-85.05`;
`z=1,x=0,y=0` → `west=-180, east=0, north≈85.05, south=0`;
`z=2,x=2,y=1` → `west=0, east=90`. (Or export `tileToBBox` — see
refactor notes; indirect assertion avoids the refactor.)

### `server/test/geoUtils.test.js` — `shared/gridUtils.js` (pure unit)

| # | Test name | Type | Priority |
|---|-----------|------|----------|
| G1 | `distanceMeters: same point 0, ~111.19km per degree lat, symmetric` | unit | P1 |
| G2 | `metersToDegLat/Lng conversions and latitude dependence` | unit | P1 |
| G3 | `bboxAround centers on point and spans ~sideMeters` | unit | P1 |

**G1** — `distanceMeters(p,p) === 0`; `{lat:0,lng:0}`→`{lat:1,lng:0}` ≈
111 195 ± 500 m; `d(a,b) ≈ d(b,a)`; 10 m-scale check at 51.5°N stays sane.

**G2** — `metersToDegLat(111_195) ≈ 1°` (±0.001);
`metersToDegLng(m,0) ≈ metersToDegLat(m)`;
`metersToDegLng(m,60) ≈ 2 × metersToDegLng(m,0)` (cos 60° = 0.5).

**G3** — `(north+south)/2 === lat`, `(east+west)/2 === lng`;
`distanceMeters({lat:south,lng},{lat:north,lng}) ≈ sideMeters` (±1%);
default `sideMeters` = 120.

### `server/test/valkeyStore.test.js` — `ValkeyStore` KV ops (unit)

Fake `FakeKvRedis`: `Map<string,string>` + `get/set/del(...keys —
tolerate array arg)/exists/keys(pattern → prefix match)`. Only implement
what's exercised.

| # | Test name | Type | Priority |
|---|-----------|------|----------|
| V1 | `ValkeyStore get/set JSON round-trip; missing key → undefined` | unit | P1 |
| V2 | `ValkeyStore del/has/keys with prefix stripping` | unit | P1 |
| V3 | `ValkeyStore all() and clear() cover only prefixed keys; size() is 0` | unit | P1 |

**V1** — `set('k',{a:1})` → `get('k')` deep-equals; `get('missing')` →
`undefined` (not `null`); value `null`/`0`/`false` survive round-trip.

**V2** — `del` → `true` then `false`; `has` toggles; seed keys under the
prefix AND a foreign prefix → `keys()` returns only stripped local keys.

**V3** — `all()` → `[[k,v],...]` skipping undefined; `clear()` empties
the prefix only — **assert it works when the fake receives `del` as an
array** (documents the array-arg call style, see observations);
`size() === 0` pinned as documented quirk.

### `server/test/valkeyLeaderboard.test.js` — `ValkeyLeaderboardStore` (unit)

Fake: extend `FakeZRedis` (zadd/zrevrange/zrange/zremrangebyrank/del)
with string-KV `get/set/del`.

| # | Test name | Type | Priority |
|---|-----------|------|----------|
| B1 | `archive() writes gameType + all zsets and meta hash; top() merges meta` | unit | P1 |
| B2 | `top() filters by gameType; omitting uses the all zset` | unit | P1 |
| B3 | `cap trim applies on archive; clear() empties zsets and meta keys` | unit | P2 |

**B1** — `archive({gameType:'snake', score:20,...})` → fake zset
`leaderboard:snake` and `leaderboard:all` both contain
`playerId:matchId@20`; `leaderboard:meta:<member>` holds JSON with name/
color/metric/finishedAt/roomName; `top(5,{gameType:'snake'})` returns
merged `{member, score, ...meta}`.

**B2** — archive one clash + one snake → `{gameType:'clash'}` top has 1;
`top(10)` reads `leaderboard:all` → 2.

**B3** — `cap:2`, archive 3 → `size` 2, lowest trimmed; `clear()` → all
three zsets (`all`,`clash`,`snake`) empty and meta keys deleted.

### Extensions to existing files

| # | Test name (append to file) | File under test | Type | Priority |
|---|---------------------------|-----------------|------|----------|
| X1 | `MemoryStore full CRUD surface (get/set/del/has/keys/all/clear/size)` — `test/memoryStore.test.js` | `shared/memoryStore.js` | unit | P2 |
| X2 | `VALKEY_URL set selects Valkey stores` — `test/memoryStore.test.js` (or new `valkeyWiring.test.js`) | `shared/memoryStore.js` bootstrap | unit | P2 |
| X3 | `redis path releases lock when fn throws` — `test/roomLock.test.js` | `shared/roomLock.js` | unit | P2 |
| X4 | `ttlMs expiry lets contender acquire; first release cannot steal it back` — `test/roomLock.test.js` | `shared/roomLock.js` | unit | P2 |

**X1** — trivial round-trip incl. `all()` skipping `undefined` values and
`size()` counting — completes the currently-partial MemoryStore coverage.

**X2** — `process.env.VALKEY_URL = 'rediss://fake:6379'` then dynamic
`import('../src/shared/memoryStore.js?case=valkey')` (query bypasses ESM
cache) → `makeRoomStores` returns `ValkeyStore` instances and
`leaderboardStore` is `ValkeyLeaderboardStore`; `redisClient` non-null.
`lazyConnect:false` means ioredis dials immediately against the bogus URL
— `client.on('error')` is already attached; test must `await
mod.redisClient.disconnect()` in `t.after` and restore env. Fragile-ish —
acceptable at P2, or prefer the injectable-factory refactor note.

**X3** — `FakeRedis` (reuse from existing file): `withLock` fn throws →
error propagates AND `redis.get(lockKey) === null` + `evalCalls === 1`
(CAS release ran in `finally`). Local-path equivalent already exists.

**X4** — acquire with `ttlMs:5`, inside fn sleep ~15 ms so the lock
expires; a second `withLock` (short `maxWaitMs` won't suffice — needs the
expiry) acquires while first still runs; first's CAS release must not
delete second's token → `redis.get(key)` still the second token. Needs
real sleeps (no fake timers in the file) — keep sleeps tiny; mark P2.

### `server/test/timeSync.test.js` — `shared/timeSync.js` (unit)

| # | Test name | Type | Priority |
|---|-----------|------|----------|
| TS1 | `time-sync with ack replies clientSendMs + serverNowMs` | unit | P2 |
| TS2 | `time-sync without ack falls back to socket.emit` | unit | P2 |

**TS1** — register on fake socket, invoke `_handlers['time-sync']
(1234, ackFn)` → ack `{clientSendMs:1234, serverNowMs}` with
`serverNowMs` ≈ `Date.now()` (±50 ms).
**TS2** — same without ack → `sock._emitted` gets `time-sync` event.

### `server/test/httpApi.test.js` — REST + CORS (BLOCKED on refactor)

Requires the `createApp`/`buildServer` extraction (see refactor notes).
After it lands: bind `server.listen(0)`, real `fetch`, real registry +
memory `leaderboardStore` (shared singleton — fine per existing tests).

| # | Test name | Type | Priority |
|---|-----------|------|----------|
| H1 | `GET /health returns {ok:true}` | integration | P1 |
| H2 | `GET /api/rooms returns registry list` | integration | P1 |
| H3 | `POST /api/rooms → 201 {room}; registry throw → 500 {error}` | integration | P1 |
| H4 | `GET /api/leaderboard clamps limit and passes gameType` | integration | P1 |
| H5 | `CORS origin handling: reflect-all, single, list, blocked` | integration | P2 |
| H6 | `parseCorsOrigin unit cases` (if exported) | unit | P2 |

**H2** — create a room through the socket path or `registry.create` →
GET → `{rooms:[meta]}`.
**H3** — POST `{name:'x'}` → 201, `room.hostId === null`; force a 500 by
injecting a throwing registry stub into `createApp` (or POST a body that
makes `registry.create` reject — simplest is the stub).
**H4** — archive clash+snake entries first; `?limit=5` → ≤5;
`?limit=999` → capped 100; `?limit=0`/`abc`/absent → 25;
`?gameType=snake` → filtered.
**H5** — `createApp({corsOrigin:'https://a.com'})`: `Origin: https://a.com`
→ `access-control-allow-origin: https://a.com`; `Origin: https://evil.com`
→ header absent; list `"https://a.com,https://b.com"` → both allowed;
`'*'`/unset → reflect.
**H6** — only if `parseCorsOrigin` is exported: unset/`''`/`'*'` → `true`;
single → string; `"a, b ,c"` → `['a','b','c']` (trims, drops empties).

---

## Refactor-for-testability notes (ordered by leverage)

1. **`index.js` — extract app factory (required for all H-tests; P1).**
   `index.js` is an entrypoint: it auto-`listen()`s, top-level `await
   registry.init()`, exports nothing. Recommend extracting to
   `src/app.js`:
   ```js
   export async function buildServer({ corsOrigin = parseCorsOrigin(process.env.CORS_ORIGIN),
                                       registry /* optional injectable */ } = {}) {
     const app = express(); /* ...routes + io + registerSocketHandlers... */
     return { app, server, io, registry };
   }
   ```
   `index.js` shrinks to `buildServer().then(({server}) => server.listen(PORT))`.
   Injectable `registry` lets H3 force the 500 path without gymnastics.
   **Fallback if refactor is declined:** spawn `node src/index.js` as a
   child process with `PORT=<free>` in the test — heavier and slower; not
   recommended.
2. **`parseCorsOrigin` — export it** (one-line change once app.js exists)
   for the cheap H6 unit cases; otherwise H5 covers it via HTTP.
3. **Disconnect grace period** — prefer `node:test`'s `mock.timers` (zero
   source churn, also handles tileProxy's `CACHE_TTL` via `Date`
   advancement). If `mock.timers` proves flaky on Node 20, the fallback
   refactor is a `RoomRegistry` constructor option
   `{ disconnectGraceMs = 30_000 }` used in place of the literal — small,
   additive, and also makes the `remainingSeconds` formula testable.
4. **`tileProxy.js`** — `tileToBBox`, `metadataCache`, `CACHE_TTL` are
   module-private. All testable without changes (T7 via `mock.timers`
   Date advance; T8 via decoded `geometry` param). Optionally export
   `tileToBBox` for a cleaner unit test — nice-to-have, not required.
5. **`shared/memoryStore.js` env branching** — `redisClient` is created at
   import time. X2 works via env + query-suffixed dynamic import, but a
   `makeRedisClient`/`makeRoomStores` variant accepting an explicit
   client would make it trivial. Optional; P2 either way.
6. **`ValkeyStore.clear()` array-arg call** — not a blocker; fakes must
   flatten `del(array)` (ioredis does). Consider normalizing to
   `del(...keys)` for consistency with `ValkeyLeaderboardStore` — cosmetic.
7. **Shared test helpers** — existing convention duplicates `makeIoStub`/
   `fakeSocket` per file; keeping that is fine. If deduplicating, note
   that `node --test`'s default glob executes any `.js` under `test/` or
   matching `test-*`/`*-test`/`*.test` — a helper module must live in a
   non-matching folder such as `server/testSupport/` to avoid being run
   as an empty test file.
