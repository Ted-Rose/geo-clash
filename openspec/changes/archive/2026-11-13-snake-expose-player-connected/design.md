# Design

## Context

`SnakeGameState` already stores `connected` on each player record —
`addPlayer` seeds `connected: true`, `RoomRegistry.softDisconnect` sets
`false`, `swapSocketId` restores `true`. The flag is dropped at the
serialization boundary: `publicPlayer()` omits it (clash's equivalent
already emits `connected: p.connected !== false`). No client work is
required server-side beyond relaying the flag.

## Goals / Non-Goals

**Goals:**
- Peers can tell a dropped snake from a merely-idle one within one tick.
- Wire change is additive only — older clients ignore the new field.

**Non-Goals:**
- No change to grace-window length, hard-leave timing, or kill rules.
- No disconnected-specific gameplay effect (a dropped snake still
  collides/eats per existing rules).
- No rename or restructure of the `snake-update` payload.

## Decisions

- **Default to `true` when the field is absent** (`connected:
  p.connected !== false`), matching clash. Records written before this
  change or by paths that never set the flag stay visible as connected —
  fail-open is correct for a presence hint.
- **Relay through the existing payload, not a separate event.** The
  `player-disconnected`/`player-reconnected` broadcasts already exist
  for instant feedback, but `connected` in `snake-update`/`snapshot`
  keeps every client's derived state convergent without ordering
  assumptions — a client that misses the broadcast still gets the truth
  on the next tick.
- **Client rendering is a styling concern**: dim/grey the marker or
  snake polyline plus a small "reconnecting" label — no new state
  management; the flag arrives inside the existing players array the
  client already renders.

## Risks / Trade-offs

- [Payload grows by one boolean per player per tick] → negligible at
  room sizes (≤8 players).
- [Client may show a brief flicker if `connected` races with an in-flight
  `player-disconnected`] → flag is authoritative; last write wins,
  self-heals next tick.
