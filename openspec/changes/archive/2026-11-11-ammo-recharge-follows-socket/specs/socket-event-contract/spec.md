# Socket Event Contract Delta

## MODIFIED Requirements

### Requirement: Broadcast scoping

Game-state emissions SHALL be scoped to `io.to(roomId)` so
concurrent matches stay isolated. Per-player events
(`ammo-update`, `snake-reset`, `clash_verify`) MUST target the
individual socket id. Per-player emissions that fire after a
sessionId re-key — including timers scheduled before the swap —
MUST target the player's current socket id, not the id captured
at schedule time.

#### Scenario: Grid diff reaches only the room

- **WHEN** a clash tick emits `grid-update`
- **THEN** only sockets joined to that room receive it

#### Scenario: Ammo recharge survives reconnect

- **WHEN** an ammo recharge timer is scheduled for a player who
  then reconnects (sessionId re-key via `swapSocketId`) before
  `ammoRenewalMs` elapses
- **THEN** the recharge still fires, mutates the re-keyed player
  record, and `ammo-update` is emitted to the new socket id
