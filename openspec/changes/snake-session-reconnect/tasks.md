# Tasks

## 1. Session interface on SnakeGameState

- [ ] 1.1 server: Extend `SnakeGameState.addPlayer` in
  `src/snake/gameState.js` to `addPlayer(id, name, sessionId)`,
  storing `sessionId` and `connected: true` on the record; verify
  `npm --prefix server test` passes.
- [ ] 1.2 server: Implement `getPlayerBySessionId(sessionId)` and
  `swapSocketId(oldId, newId)` on `SnakeGameState`, mirroring the
  clash versions (re-key record, `id`/`connected` update, old-key
  delete) plus `acksNeeded` migration across `_pendingClashes`;
  verify `npm --prefix server test` passes.

## 2. Tests

- [ ] 2.1 server: Rewrite `test/reconnect.test.js` "snake room
  ignores sessionId — no reconnect support" and "snake room at
  capacity returns room-full even with a sessionId" to assert the
  reconnect path (`reconnected: true`, player re-keyed,
  `player-reconnected` broadcast, `playerCount` unchanged even at
  `maxPlayers`); verify `node --test test/reconnect.test.js`
  passes.
- [ ] 2.2 server: Add `test/snake/players.test.js` cases for the
  new methods — `addPlayer` stores `sessionId`/`connected`,
  `getPlayerBySessionId` hit/miss, `swapSocketId` re-keys and
  migrates `acksNeeded`; verify
  `node --test test/snake/players.test.js` passes.
- [ ] 2.3 server: Verify `npm --prefix server test` is green.

## Workflow follow-up

- Archive the change after the project's review requirements are
  satisfied.
