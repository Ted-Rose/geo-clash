# Proposal

## Why

`server/src/snake/collisions.js` filters collision candidates on
`p.inGrace`, then sets that flag *inside* the loop the filter already
excluded them from — so the reset line is unreachable and a
killed-and-respawned snake stays `inGrace = true` forever: unkillable
and unable to kill (a permanent ghost). Spawn protection should only
last `SPAWN_GRACE_MS` (3 s). Tracked as issue #26; found during the
`harden-reconnect-robustness` review.

## What Changes

- Server: remove the `inGrace` flag from collision eligibility — the
  `spawnedAt` timestamp check inside `resolveCollisions` already
  defines the grace window. A respawned player is collision-safe for
  exactly `SPAWN_GRACE_MS`, then collides normally.
- Server: stop writing `inGrace` (the flag is redundant bookkeeping on
  live object refs that would silently no-op under the Valkey store
  anyway).
- Tests: update the collision tests that codified flag persistence;
  add a regression test that a respawned player collides again after
  the window.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `gameplay-authority`: spawn-grace protection SHALL be a bounded
  time window keyed to `spawnedAt` — it expires and never becomes
  permanent invulnerability.

## Impact

- Workspaces: **server/** only — `server/src/snake/collisions.js`,
  `server/src/snake/gameState.js` (inGrace writes), collision tests.
- Socket event contract: unchanged — `spawnedAt` is already relayed.
- Seeded spec affected: `gameplay-authority` (delta included).
- No hardware dependency; existing bot/debug paths suffice.
