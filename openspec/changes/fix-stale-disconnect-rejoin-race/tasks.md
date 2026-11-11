# Tasks

## 1. Registry fix

- [ ] 1.1 server: store `sessionId` on `socket.data` in both join paths
  of `RoomRegistry.join()` (fresh join and session reconnect); verify
  the value is present by asserting it in a registry test
- [ ] 1.2 server: in `softDisconnect`'s miss branch, call
  `getPlayerBySessionId(socket.data.sessionId)` when available; return
  silently when the resolved record is keyed to a different socket id,
  keep the hard-leave fallback otherwise; verify a regression test
  reproduces the race (rejoin → fire old disconnect → no `player-left`,
  `playerCount` unchanged) and `npm --prefix server test` passes
- [ ] 1.3 server: verify `openspec validate --all --strict` passes with
  the new spec delta
