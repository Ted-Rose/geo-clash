# Fix stale leave after session re-key

## Problem

`RoomRegistry.leave()` removes a player and emits its side effects
unconditionally. Two callers can reach it with a socket id whose session
has already been re-keyed to a different socket:

1. The disconnect grace timer in `softDisconnect` fires `leave()` with
   a fake socket carrying the *old* socket id. If the player rejoined
   on a new socket at the grace boundary, the timer still runs the
   removal path: `removePlayer` misses under the old id, but
   `player-left` is broadcast anyway, `playerCount` is decremented, and
   the room can be destroyed while the reconnected player is in it.
2. A stale live socket (a duplicate tab, a lingering recovered
   connection) can emit `room-leave` after another socket re-keyed the
   session — same unconditional side effects.

`softDisconnect` itself already guards this class (it checks
`socket.data.sessionId` against `getPlayerBySessionId`); `leave()` has
no equivalent check.

## Proposed change

Extend the stale-socket guard to `leave()`:

- `leave()` first looks up the player under `socket.id`. On a miss it
  resolves `socket.data.sessionId` via `getPlayerBySessionId`; if the
  record is keyed to a different socket id, return silently — no
  `player-left`, no `playerCount` change, no room destroy.
- The disconnect-grace fake socket carries `data.sessionId` so the
  timer-expiry path benefits from the same guard.
- A miss with no re-keyed record keeps the existing hard-leave
  behavior.

## Scope

- `server/src/roomRegistry.js` (`leave`, `softDisconnect` timer)
- `server/test/` regression tests
- Spec delta: `room-lifecycle` (MODIFIED requirement)
