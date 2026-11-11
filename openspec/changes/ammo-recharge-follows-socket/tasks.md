# Tasks

## 1. Recharge timers follow the current socket id

- [ ] 1.1 server: Change `_ammoTimers` values in
  `src/clash/gameState.js` to `{ playerId, handle }` records —
  `_scheduleAmmoRecharge` stores the record, the timeout callback
  resolves `rec.playerId` at fire time for both the
  `playerStore` lookup and the scoped `ammo-update` emit, and the
  `endMatch` sweep clears `rec.handle`; verify
  `npm --prefix server test` passes.
- [ ] 1.2 server: Extend `swapSocketId` to rewrite `rec.playerId`
  on `_ammoTimers` records matching `oldId`; verify
  `npm --prefix server test` passes.
- [ ] 1.3 server: Add a regression test in
  `test/clash/ammo.test.js` — attack (spend ammo), `swapSocketId`,
  wait past `ammoRenewalMs` → ammo incremented on the new key and
  `ammo-update` scoped to the new socket id; verify
  `node --test test/clash/ammo.test.js` passes.

## Workflow follow-up

- Archive the change after the project's review requirements are
  satisfied.
