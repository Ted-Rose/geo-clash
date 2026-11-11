# Tasks

## 1. Server: split clash gameState

- [x] 1.1 server: Extract the tick-time occupancy/capture-progress
  block and `_scores`/`_recountScores` into `clash/capture.js` as
  exported functions taking the `GameState` instance; verify
  `npm --prefix server test` passes (capture + lifecycle suites).
- [x] 1.2 server: Extract `attack`, `_scheduleAmmoRecharge`,
  `_scheduleResolution`, `_resolveProjectile` into `clash/combat.js`;
  verify combat + ammo tests pass and `gameState.js` is under ~300
  lines.

## 2. Server: split snake gameState

- [x] 2.1 server: Extract the `_pendingClashes` handshake
  (`clashAck`, `cancelClashesFor`, `_killPlayer`, initiation from
  collision detection) into `snake/clashHandshake.js`; verify
  `clashHandshake`, `headOnHead`, `killPlayer`, and `lastAlive` test
  files pass.

## 3. Client: split screens

- [x] 3.1 client: Extract all socket subscriptions + snapshot apply +
  gameplay state from `clash/GameScreen.jsx` into
  `clash/useClashGame.js` returning a flat render-state object;
  verify `npm --prefix client run build` and
  `npm --prefix client test` pass and a manual smoke (create room →
  join → move → attack) works.
- [x] 3.2 client: Split `shared/LobbyScreen.jsx` into
  `RoomCreateForm` and `RoomList` sibling components; verify build +
  client tests pass and lobby flows (list, create, join) still work
  manually.

## Workflow follow-up

- Archive the change after the project's review requirements are
  satisfied.
