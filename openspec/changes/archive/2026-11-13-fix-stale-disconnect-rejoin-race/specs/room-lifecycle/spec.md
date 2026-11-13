# Spec Delta

## ADDED Requirements

### Requirement: Stale disconnect after session reconnect is ignored

When `softDisconnect` finds no player record under the disconnecting
socket id but the socket's `sessionId` resolves to a player already
re-keyed to a different socket, the disconnect SHALL be treated as
stale: no `player-left` broadcast and no `playerCount` change. A miss
with no re-keyed record keeps the existing hard-leave fallback.

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
