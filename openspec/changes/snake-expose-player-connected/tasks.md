# Tasks

## 1. Server payload

- [ ] 1.1 server: add `connected: p.connected !== false` to snake
  `publicPlayer()` in `server/src/snake/gameState.js`; verify a unit
  test or manual `snapshot()`/`snake-update` inspection shows the field
- [ ] 1.2 server: add/adjust a test asserting snake `snapshot()` player
  entries include `connected`, and that it flips `false` after
  `softDisconnect` and `true` after `swapSocketId`; verify
  `npm --prefix server test` passes

## 2. Client rendering

- [ ] 2.1 client: render `connected: false` snakes distinctly in the
  snake game view (dimmed marker/polyline + "reconnecting" indicator);
  verify in a two-browser session that killing one tab greys its snake
  for the peer within ~1s
- [ ] 2.2 both: verify end-to-end — join two snake clients, drop one
  (close tab / kill socket), confirm peer UI shows disconnected state
  and it clears on rejoin; confirm `npm --prefix client run build`
  succeeds
