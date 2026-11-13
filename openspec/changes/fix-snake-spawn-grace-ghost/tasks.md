# Tasks

## 1. Remove the sticky grace flag

- [x] 1.1 server: In `server/src/snake/collisions.js`, drop `inGrace`
  from the candidate filter and remove both `p.inGrace` assignments —
  the `spawnedAt`/`SPAWN_GRACE_MS` checks already bound the window;
  verify `resolveCollisions` tests still pass
- [x] 1.2 server: Remove any remaining `inGrace` writes in
  `server/src/snake/gameState.js`/`clashHandshake.js` if present;
  verify `grep -rn inGrace server/src` returns nothing
- [x] 1.3 server: Add a regression test — a respawned player whose
  `spawnedAt` is older than `SPAWN_GRACE_MS` collides normally (can
  die and can kill), and update the test codifying flag persistence;
  verify `npm --prefix server test` passes
- [x] 1.4 server: Verify `openspec validate --all --strict` passes
  with the new spec delta
