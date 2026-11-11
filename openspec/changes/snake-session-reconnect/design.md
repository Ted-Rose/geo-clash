# Design

## Context

`RoomRegistry.join` is already game-agnostic about reconnect: the
sessionId branch runs whenever the game instance answers
`getPlayerBySessionId` (duck-typed capability check,
`roomRegistry.js` ~line 167). Everything downstream — disconnect-
timer cancel, `socket.join`, handler re-registration via
`GAME_HANDLERS`, `joined`+`snapshot` emits, `player-reconnected`
broadcast — is shared. The missing half is entirely inside
`SnakeGameState`. The clash `GameState` provides the reference
implementation (`clash/gameState.js` ~lines 199-226).

## Goals / Non-Goals

**Goals:**
- A snake `room-join` carrying a known `sessionId` takes the
  reconnect path: player record re-keyed, `connected: true`,
  pending disconnect timer cancelled, `player-reconnected`
  broadcast, `playerCount` unchanged.
- A pending `clash_verify` the player was a participant in can
  still be ACKed from the new socket.

**Non-Goals:**
- No client change — `sessionId` is already sent unconditionally.
- No registry changes — the duck-typed check is the extension
  point by design.
- No migration of other socket-keyed structures beyond
  `_pendingClashes` (snake keeps no other per-socket timers).

## Decisions

- **Mirror the clash method shapes verbatim.**
  `getPlayerBySessionId` returns `{ player, socketId }` from an
  `playerStore.all()` scan; `swapSocketId` re-keys the record,
  sets `p.id = newId` / `p.connected = true`, deletes the old key.
  Alternative: a shared mixin/base class — rejected: two
  implementations do not justify an abstraction, and the fields
  differ (snake has no grid store to remap).
- **`addPlayer` gains `sessionId` and `connected: true`.** The
  registry already passes `sessionId` as arg 3
  (`roomRegistry.js` ~line 205); snake simply starts storing it.
  `connected` is added for parity — `softDisconnect` already
  writes `connected: false` onto snake records.
- **`swapSocketId` migrates `_pendingClashes`.** `acksNeeded` is a
  `Set` of socket ids; on swap, entries containing `oldId` get
  `delete(oldId)` + `add(newId)` so the reconnected socket's
  `clash_ack` (validated against `socket.id`) still counts.
  Alternative: let the pending clash expire — rejected: an
  in-flight kill would silently void on every reconnect.
- **No `snake-reset` on reconnect.** The client's reconnect flow
  already rebuilds from `snapshot`; the record's `tailPoints` /
  `score` are preserved as-is.

## Risks / Trade-offs

- [Reconnect steals a session while the old socket is still live]
  → same semantics as clash ("session takeover" is pinned
  behavior); no new risk introduced.
- [Stale-record cleanup relied on the grace timer firing] → the
  timer is cancelled by the shared registry path, so the record
  is re-keyed instead of duplicated — `playerCount` stays
  correct, which is precisely the fix.
- [O(n) `playerStore.all()` scan on every join] → identical to
  clash; rooms cap at `maxPlayers` (default 8).
