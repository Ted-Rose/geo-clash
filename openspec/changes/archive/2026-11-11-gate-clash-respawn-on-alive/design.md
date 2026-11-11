# Design

## Context

`respawn()` exists to bring a dead player back at their base cell.
The methods that mutate a live player (`updateLocation`,
`activateShield`, `attack` — `server/src/clash/gameState.js` ~lines
242, 253, 263) all early-return on `!p.alive`; respawn is the only
entry point that never distinguishes alive from dead. Because
`addPlayer` spawns players at the base-cell center, the exploit is
reachable with zero movement and zero setup.

## Goals / Non-Goals

**Goals:**
- A live player's `player-respawn` request changes no state and
  emits nothing.
- Dead-player respawn semantics are byte-for-byte identical:
  base-cell gate, `respawn-denied { reason: 'not-at-base' }`, state
  reset, `player-respawn` + scoped `ammo-update` emits.

**Non-Goals:**
- No `matchActive` gate — whether respawn should run outside an
  active match is a separate question (flagged in
  `test-plans/clash-game.md` alongside this bug) and out of scope.
- No client change — the server no-op is the authoritative fix;
  the client may additionally hide the respawn affordance while
  alive, but that is not required here.

## Decisions

- **Silent no-op, not `respawn-denied`.** Alternative: emit
  `respawn-denied` with a new reason (e.g. `alive`). Rejected —
  no client renders that reason, a new reason string is
  socket-contract churn for zero UX gain, and the existing `!p` /
  `!this.grid` guards already fail silently.
- **Guard order: alive → grid → base cell.** Only a dead player
  can ever reach the `not-at-base` denial, so the dead-player path
  is untouched and a live player gets identical behavior
  regardless of position or grid state.

## Risks / Trade-offs

- [A live player loses an accidental "heal" they relied on] → that
  is the exploit being closed; the pinning test is inverted, not
  deleted, so the new contract stays documented.
- [Silent no-op hides client misuse] → acceptable; the
  `respawn-denied` emit remains for the actionable dead-player
  case (wrong cell).
