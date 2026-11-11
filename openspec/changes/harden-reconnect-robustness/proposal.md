# Proposal

## Why

A post-merge review of the module-decomposition refactor (PR #15) —
done under the documented connectivity & trust model — found that the
refactor itself is clean, but surfaced a cluster of pre-existing
reconnect/fairness defects and small performance leaks. Because the
game is played on phones crossing flaky field Wi-Fi, these defects map
directly onto real play: a same-socket rejoin can silently delete the
player, disconnecting dodges snake kills entirely, and `eat_food`
accepts fabricated claims. Fixing them is what makes the trust model
("no lost progress, but offline is never an exploit") actually hold.

## What Changes

- **Same-socket rejoin guard (server, both games).** A `room-join`
  carrying a `sessionId` that resolves to the *same* socket id SHALL
  be treated as an idempotent rejoin: no player re-key (today
  `swapSocketId` deletes its own record), no duplicate gameplay
  handler registration (today `player-attack`/`location-update` fire
  twice per emit).
- **Re-key completeness (server, clash).** `swapSocketId` SHALL also
  retarget in-flight `projectileStore` `attackerId` values so a
  reconnected shooter cannot be hit by their own arrow, and
  `removePlayer` SHALL cancel that player's pending ammo-recharge
  timers.
- **Score integrity (server).** Snake `endMatch` SHALL compute final
  scores before purging `playerStore` (today `match-end` always emits
  `scores: {}`), and clash score recounts SHALL run on roster changes
  so departed players stop appearing in `grid-update` scores.
- **Kill-dodge hardening (server, snake).** A pending clash whose
  killer ACKed SHALL still commit when the victim fails to ACK —
  whether via timeout or disconnect — closing the
  disconnect-to-survive exploit. Deliberately reverses the current
  "any outstanding ack voids the kill" rule; see design for the
  trade-off.
- **Food-claim validation (server, snake).** `eat_food` SHALL award a
  point only for a `foodId` that is live or recently legitimately
  claimed — fabricated ids no longer score.
- **Client cleanup (client).** Clash debug bots SHALL be torn down on
  unmount (intervals + sockets; today a stale-closure `[]` deps effect
  leaks them until page unload), and `ProjectileLayer` SHALL only run
  its rAF loop while projectiles exist (battery on phones).
- **Tick hygiene (server).** Hoist the per-tick player list instead of
  re-reading `playerStore.all()` three times per 200 ms tick, emit the
  `timer` broadcast only when the integer second changes, and log —
  not swallow — snake tick errors. These are prep for the
  Redis/Valkey store swap, where every `.all()` becomes a network
  round-trip.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `room-lifecycle`: session reconnect SHALL be idempotent for a
  rejoin on the same socket id and SHALL retarget all state that
  references the player id, including in-flight projectiles and
  pending timers.
- `gameplay-authority`: the snake kill handshake no longer voids a
  killer-ACKed clash on victim timeout/disconnect; `eat_food` claims
  SHALL be validated against live/recently-claimed food; clash
  score broadcasts SHALL reflect the current roster; snake
  `match-end` SHALL carry real final scores.
- `socket-event-contract`: the join/reconnect handshake SHALL be
  idempotent — rejoin on the same socket does not re-register
  gameplay handlers.

## Impact

- Workspaces: **both** — `server/src/roomRegistry.js`,
  `server/src/clash/{gameState,combat,lifecycle,capture}.js`,
  `server/src/snake/{gameState,clashHandshake}.js`; `client/src/clash/
  GameScreen.jsx`, `client/src/shared/` (ProjectileLayer).
- Socket event contract: no new or renamed events; payload shapes
  unchanged except `match-end.scores` actually being populated.
  Semantics of existing events tightened (idempotent rejoin,
  validated `eat_food`, kill commit on victim timeout).
- Seeded specs affected: `room-lifecycle`, `gameplay-authority`,
  `socket-event-contract` — deltas included in this change.
- No hardware dependency; existing Simulate-Movement and bot debug
  paths suffice for verification.
