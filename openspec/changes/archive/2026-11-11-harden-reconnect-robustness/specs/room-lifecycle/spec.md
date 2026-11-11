# Spec Delta

## ADDED Requirements

### Requirement: Idempotent same-socket rejoin

When a `room-join` carrying a `sessionId` resolves to a player already
keyed to the *same* socket id, the rejoin SHALL succeed as a no-op:
the player record and room membership are left untouched, gameplay
handler binding is refreshed only when the socket is not already
bound to the live game, and no re-key or hard-leave side effects
occur. If the player was marked `connected: false` by a prior soft
disconnect, the rejoin SHALL restore `connected: true` and broadcast
`player-reconnected`.

#### Scenario: Rejoin echo on the same socket

- **WHEN** a connected client emits `room-join` with the `sessionId`
  of its own live player record
- **THEN** the join resolves successfully, the player record survives
  intact, and no `player-left` or duplicate gameplay state results

#### Scenario: Recovered socket rejoins after soft disconnect

- **WHEN** a recovered Socket instance (same id, restored
  `socket.data`, no listeners) emits `room-join` for a player marked
  `connected: false`
- **THEN** gameplay handlers are re-registered on the new instance,
  `connected` is restored to `true`, and the room sees
  `player-reconnected`

### Requirement: Re-key retargets in-flight references

When a session reconnect re-keys a player to a new socket id, every
stored reference to that player SHALL follow the new id — including
in-flight projectile ownership and pending per-player timers — and a
removed player's pending timers SHALL be cancelled.

#### Scenario: Arrow survives the shooter's reconnect

- **WHEN** a clash player fires a projectile and reconnects via
  `sessionId` before it resolves
- **THEN** the projectile still resolves under the re-keyed id and
  cannot register a hit on its own shooter

#### Scenario: Removed player's timers never fire

- **WHEN** a player is removed while an ammo recharge timer is pending
- **THEN** the timer is cancelled and never mutates state or emits
  `ammo-update`
