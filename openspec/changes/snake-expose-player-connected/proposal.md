# Proposal

## Why

Snake player records carry a `connected` flag (set by `softDisconnect`,
restored by `swapSocketId`), but `publicPlayer` never relays it — so a
soft-disconnected snake renders frozen to peers with no indication it
dropped, until the grace timer hard-leaves it. Clash already exposes the
same flag; snake should match parity.

## What Changes

- Server: include `connected` in the snake player payload broadcast via
  `snake-update` ticks and `snapshot` (additive field — backward
  compatible).
- Client: visually distinguish `connected: false` snakes (e.g. dimmed
  marker / "reconnecting" badge) so peers see the drop immediately
  instead of a silently frozen snake.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `gameplay-authority`: the snake relayed-player payload gains a
  server-owned `connected` presence flag, and clients SHALL render
  disconnected peers distinctly.

## Impact

- Workspaces: **both** — `server/src/snake/gameState.js`
  (`publicPlayer`), snake client rendering (`client/src/snake/` or the
  snake `GameScreen`).
- Socket event contract: no event names or flow change — additive field
  on the existing `snake-update`/`snapshot` player shape.
- No hardware dependency; no mock path needed.
