# Spec Delta

## ADDED Requirements

### Requirement: Snake meta records effective game config

For snake rooms, meta SHALL record the game instance's effective
`arenaSideMeters`, `foodCountTarget`, `foodRespawnIntervalMs`, and
`timeLimitMs` — the values the game actually runs with — never
registry-side defaults.

#### Scenario: Snake meta mirrors effective game config

- **WHEN** `room-create` creates a snake room without explicit
  `arenaSideMeters`, `foodCountTarget`, or `foodRespawnIntervalMs`
- **THEN** the persisted meta reports the same values the constructed
  game instance uses, so the lobby listing cannot advertise settings
  the game ignores
