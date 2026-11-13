# Spec Delta

## ADDED Requirements

### Requirement: Snake presence flag relay

The server SHALL include a `connected` boolean in every snake player
payload it broadcasts (`snapshot` and `snake-update`), reflecting the
registry-managed connection state. Clients SHALL visually distinguish
`connected: false` peers so a dropped snake is not indistinguishable
from a frozen one.

#### Scenario: Peer sees a dropped snake

- **WHEN** a snake player's socket soft-disconnects during a match
- **THEN** the next `snake-update` (and any `snapshot`) reports that
  player with `connected: false` and peer clients render it as
  disconnected

#### Scenario: Rejoin restores presence

- **WHEN** a soft-disconnected snake player rejoins via session reconnect
- **THEN** subsequent payloads report `connected: true` and peers render
  the snake normally again
