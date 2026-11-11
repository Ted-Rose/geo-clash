# Proposal

## Why

Clash rooms support sessionId-based reconnect: `RoomRegistry.join`
finds the stored player via `getPlayerBySessionId`, cancels the
pending disconnect timer, re-keys the record via `swapSocketId`,
and broadcasts `player-reconnected`. Snake rooms don't —
`SnakeGameState` (`server/src/snake/gameState.js`) implements
neither method and its `addPlayer(id, name)` ignores the
`sessionId` the registry already passes. A snake player who drops
and rejoins (mobile network flap, page refresh — the client sends
`sessionId` for every `room-join` regardless of `gameType`) falls
through to `addPlayer`: a duplicate player record is created, the
grace timer eventually hard-leaves the stale one, and — pinned in
`server/test/reconnect.test.js` — a room at `maxPlayers` flatly
rejects the rejoining player with `room-full`.

## What Changes

- **server:** extend the session-reconnect interface to snake —
  `SnakeGameState.addPlayer` accepts and stores `sessionId` (plus
  `connected: true`), and the class gains `getPlayerBySessionId`
  and `swapSocketId` mirroring the clash implementations.
  `swapSocketId` additionally migrates `acksNeeded` membership in
  `_pendingClashes` so a reconnected participant can still answer
  an in-flight `clash_verify`. `RoomRegistry.join` needs no
  change — its existing `typeof game.getPlayerBySessionId ===
  'function'` check picks snake up automatically.
- **server tests:** rewrite the two `reconnect.test.js` cases that
  pin the missing-snake behavior ("snake room ignores sessionId",
  "snake room at capacity returns room-full") to assert the
  reconnect path instead; add snake `players.test.js` coverage for
  the new methods.

No socket events, payload shapes, or client code change — the
client already sends `sessionId` on `room-join` and on reconnect.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `socket-event-contract` — "Join handshake sequence": the
  sessionId reconnect path now applies to snake rooms; the
  "snake reconnect is a fresh join" scenario is replaced.
- `room-lifecycle` — "Disconnect grace period": the snake carve-
  out (timer fires, stale record hard-leaves) is removed; a snake
  rejoin inside the window cancels the timer like clash.

## Impact

- `server/src/snake/gameState.js`: `addPlayer` signature +
  record fields, two new methods (~30 lines, mirroring clash).
- `server/test/reconnect.test.js`: two tests inverted;
  `server/test/snake/players.test.js`: new cases.
- Verified by `npm --prefix server test`.
