# Design

## Context

See `proposal.md` for the bug. `resolveCollisions`
(`server/src/snake/collisions.js`) filters candidates on `!p.inGrace`,
then assigns `p.inGrace = true/false` inside the loop — the `false`
reset is unreachable once the flag sticks, and under a real KV store
(`all()` returning copies, not live refs) the writes would silently
no-op anyway. `spawnedAt` already carries the grace window and is set
on join (`gameState.js:229`) and on kill respawn
(`clashHandshake.js:121`).

## Goals / Non-Goals

**Goals:**
- Spawn grace is strictly a time window over `spawnedAt` — bounded,
  no flag state.
- Regression test proves post-window collisions resolve.

**Non-Goals:**
- No change to grace duration, collision radii, or payload shapes.
- No client changes.

## Decisions

- **Delete `inGrace` entirely rather than fix its reset.** The
  `spawnedAt` check inside the per-player loop already implements the
  window; a second flag duplicates that truth and is what broke. Less
  state, no reset bug possible. Alternative considered: reset the flag
  in `_tick`/`updateLocation` — keeps redundant state alive.
- **Filter on `alive` only; keep the `spawnedAt` window checks inside
  the loop** for both the actor (`p`) and the target (`other`) —
  symmetric safety, matching the existing comment.

## Risks / Trade-offs

- Player records may still carry a stale `inGrace` field written by
  the old code → harmless dead field; relayed payloads (`publicPlayer`)
  don't include it. No migration needed.
