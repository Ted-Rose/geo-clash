# Tasks

## 1. Registry fix

- [x] 1.1 server: in `RoomRegistry.leave()`, look up the player under
  `socket.id` before running removal side effects; on a miss, resolve
  `socket.data.sessionId` via `getPlayerBySessionId` and return
  silently when the record is keyed to a different socket id. Keep the
  existing path when a record exists or no re-keyed record is found.
- [x] 1.2 server: copy `sessionId` onto the grace-timer fake socket in
  `softDisconnect` (`data: { sessionId: socket.data?.sessionId }`) so
  the expiry path is covered by the same guard; verify a regression
  test shows a timer firing after rejoin emits no `player-left` and
  leaves `playerCount` unchanged.
- [x] 1.3 server: add a regression test for a stale live socket's
  `room-leave` after session re-key (no `player-left`, `playerCount`
  unchanged, reconnected player still in the room); verify
  `npm --prefix server test` passes.
- [x] 1.4 server: verify `openspec validate --all --strict` passes
  with the new spec delta.
