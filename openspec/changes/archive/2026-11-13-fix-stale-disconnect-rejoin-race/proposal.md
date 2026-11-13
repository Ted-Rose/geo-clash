# Proposal

## Why

If a client rejoins on a new socket (session reconnect re-keys the
player record) *before* the old socket's `disconnect` event fires —
normal ping-timeout lag — `softDisconnect` finds no record under the old
socket id and falls into the hard-leave fallback: it broadcasts a
spurious `player-left` and decrements `playerCount`, permanently
drifting the count low. Affects clash today and snake since session
reconnect landed.

## What Changes

- Server: `softDisconnect` distinguishes a stale disconnect (player
  already re-keyed to a different socket via session reconnect) from a
  genuine missing-player leave. Stale disconnects become a no-op — no
  `player-left`, no `playerCount` mutation.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `room-lifecycle`: disconnects arriving for a socket that no longer
  owns a player record (re-keyed by session reconnect) SHALL be ignored
  as stale rather than treated as a hard leave.

## Impact

- Workspaces: **server/** only — `server/src/roomRegistry.js`
  (`softDisconnect`), plus `socket.data.sessionId` plumbing at join.
- Socket event contract: unchanged — `player-left` simply stops firing
  spuriously; clients already handle both events.
- No hardware dependency; no mock path needed.
