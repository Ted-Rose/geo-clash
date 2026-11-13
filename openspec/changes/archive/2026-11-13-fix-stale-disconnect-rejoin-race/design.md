# Design

## Context

`softDisconnect` currently looks the player up by `socket.id` only. A
session reconnect (`swapSocketId(oldId → newId)`) removes the old key
while the old socket's `disconnect` is still in flight behind the ping
timeout, so the lookup misses and the hard-leave fallback fires against
a player that is still present under a new key. `socket.data` already
carries `roomId`/`gameType` but not `sessionId`.

## Goals / Non-Goals

**Goals:**
- A disconnect for an already-migrated socket id is a silent no-op.
- Genuine missing-player disconnects keep the existing hard-leave
  fallback unchanged.

**Non-Goals:**
- No changes to the reconnect path, grace-window length, or
  `playerCount` accounting elsewhere.
- No client changes; no attempt to suppress the `disconnect` event
  itself (transport ordering is out of our control).

## Decisions

- **Carry `sessionId` on `socket.data` at join** (both the fresh-join and
  reconnect branches already know it). Alternative considered: a
  registry-side `Map` of migrated oldIds — rejected because it adds
  state to maintain and clean up, while `sessionId` lookup reuses the
  session interface games already implement.
- **In `softDisconnect`'s miss branch, consult
  `getPlayerBySessionId(socket.data.sessionId)`.** If it returns a
  record keyed to a different socket id → stale disconnect → return
  silently. If it returns null (or the game lacks the session
  interface) → existing hard-leave fallback, unchanged.
- **Sockets without a `sessionId`** (e.g. a join that predates it)
  skip the lookup and keep the fallback — no behavior change for them.

## Risks / Trade-offs

- [A malicious client could replay someone else's `sessionId` to dodge
  a leave] → out of scope: `sessionId` is a sessionStorage UUID with no
  auth model in the MVP; the same replay already lets them hijack the
  seat entirely via the reconnect path.
- [`socket.data.sessionId` could go stale across rooms] → scoped to the
  `roomId` under lock in `softDisconnect`; a stale sessionId can only
  suppress a leave for the same player identity in that room.
