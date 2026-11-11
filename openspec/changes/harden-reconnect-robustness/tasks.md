# Tasks

## 1. Reconnect idempotency and re-key completeness

- [ ] 1.1 server: In `roomRegistry.js` reconnect path, treat a
  `sessionId` rejoin resolving to the same socket id as an idempotent
  join (re-emit `joined` + `snapshot`, skip `swapSocketId` and handler
  registration); verify with a node --test case asserting the player
  record survives a same-socket rejoin
- [ ] 1.2 server: Add `oldId === newId` early-return in both games'
  `swapSocketId` and a `socket.data.handlersRegistered` once-guard in
  `registerClashHandlers`/`registerSnakeHandlers`; verify a test
  emitting `room-join` twice on one socket produces exactly one
  `player-attack` handling per emit
- [ ] 1.3 server: Re-key `projectileStore` `attackerId` values inside
  clash `swapSocketId`; verify with a test that a projectile fired
  before reconnect cannot hit its own shooter after re-key
- [ ] 1.4 server: Cancel a removed player's pending `_ammoTimers`
  entries in `removePlayer`, and declare `_projectileTimers`,
  `_lastPlayersCache`, `_lastCellsCache` in the clash `GameState`
  constructor; verify no `ammo-update` fires after player removal

## 2. Score integrity

- [x] 2.1 server: In snake `endMatch`, compute `finalScores` from the
  pre-purge player list before `playerStore.clear()`; verify
  `match-end.scores` is populated in a test ending a snake match
- [ ] 2.2 server: Invalidate/recompute clash scores on `addPlayer`/
  `removePlayer` (or derive the tally in `processCaptures` from the
  already-fetched lists); verify a `grid-update` after a leave omits
  the departed player

## 3. Offline-is-not-an-exploit hardening

- [x] 3.1 server: Change `clashHandshake.js` so the kill commits once
  the killer ACKs inside the window, treating the victim's ack as
  advisory (victim timeout/disconnect no longer voids); verify tests
  for killer-ack+victim-timeout commits and killer-timeout voids
- [x] 3.2 server: Validate `eat_food` against the live food list or
  `_recentlyEaten` (3000 ms window); verify fabricated `foodId`
  claims award nothing while a second racer's claim still scores

## 4. Client leaks and tick hygiene

- [ ] 4.1 client: Keep clash debug bots in a `useRef` and clear their
  intervals/sockets in the unmount effect; verify via vitest that
  unmounting after spawning a bot leaves no running interval
- [ ] 4.2 client: Gate `ProjectileLayer`'s rAF loop on
  `projectiles.length > 0`; verify no rAF runs while the layer is
  empty
- [ ] 4.3 server: Hoist the per-tick `playerStore.all()` once and pass
  it into `processCaptures`, emit `timer` only when the integer
  second changes, and add `console.error` to the snake `_tick` catch;
  verify store reads per tick drop to one via a spy test

## 5. Verification

- [ ] 5.1 both: Run `npm --prefix server test` plus the client vitest
  suite and manual smoke (two tabs, kill Wi-Fi on one, rejoin within
  grace — progress and projectiles behave per spec)

## Workflow follow-up

- Archive the change after the project's review requirements are
  satisfied (`openspec-archive-change`).
