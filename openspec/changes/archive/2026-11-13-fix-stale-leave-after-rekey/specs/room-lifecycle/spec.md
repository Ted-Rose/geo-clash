# Spec Delta

## MODIFIED Requirements

### Requirement: Stale disconnect after session reconnect is ignored

When `softDisconnect` or `leave` finds no player record under the
socket id but the socket's `sessionId` resolves to a player already
re-keyed to a different socket, the operation SHALL be treated as
stale: no removal side effects — no `player-left` broadcast, no
`playerCount` change, no room destroy. This covers the disconnect
grace timer firing with a stale socket id and explicit `room-leave`
events from stale sockets. A miss with no re-keyed record keeps the
existing hard-leave fallback.

#### Scenario: Rejoin beats the ping timeout

- **WHEN** a player rejoins on a new socket via `sessionId` and the old
  socket's `disconnect` fires afterwards
- **THEN** the disconnect is ignored — the reconnected player stays in
  the room, no `player-left` is broadcast, and `playerCount` is
  unchanged

#### Scenario: Genuine missing player still hard-leaves

- **WHEN** `softDisconnect` finds no record under the socket id and no
  re-keyed record for its `sessionId`
- **THEN** the hard-leave fallback runs as before: `player-left`
  broadcast and `playerCount` decremented

#### Scenario: Grace timer fires after rejoin

- **WHEN** a player rejoins on a new socket via `sessionId` and the old
  socket's disconnect grace timer subsequently expires
- **THEN** the timer-triggered leave is ignored — the reconnected
  player stays in the room, no `player-left` is broadcast, and
  `playerCount` is unchanged

#### Scenario: Stale socket's room-leave is ignored

- **WHEN** a player's session is re-keyed to a new socket and the old,
  still-connected socket emits `room-leave`
- **THEN** the leave is ignored — no `player-left` is broadcast and
  `playerCount` is unchanged
