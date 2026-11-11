# Room Lifecycle Delta

## MODIFIED Requirements

### Requirement: Disconnect grace period

`softDisconnect` SHALL mark the player `connected: false`, emit
`player-disconnected`, and schedule a hard leave after a grace
window — 30 s, or remaining match time + 30 s during an active
match. A `sessionId` rejoin inside the window cancels the timer in
every game implementing the session interface (clash and snake).

#### Scenario: Mobile reconnect within grace

- **WHEN** a clash socket disconnects mid-match and rejoins with
  its `sessionId` before the grace timer fires
- **THEN** the player record is re-keyed to the new socket, its
  cells and progress are preserved, and `player-reconnected` is
  broadcast

#### Scenario: Snake reconnect within grace

- **WHEN** a snake player rejoins with its `sessionId` inside the
  grace window
- **THEN** the disconnect timer is cancelled, the player record
  is re-keyed to the new socket (score, tail, and pending-clash
  participation preserved), and `player-reconnected` is broadcast

#### Scenario: Grace expiry removes the player

- **WHEN** the grace timer fires with no rejoin
- **THEN** a hard leave runs: player removed, `player-left`
  broadcast, `playerCount` decremented
