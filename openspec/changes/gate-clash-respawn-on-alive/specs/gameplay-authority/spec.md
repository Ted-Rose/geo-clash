# Gameplay Authority Delta

## MODIFIED Requirements

### Requirement: Base-cell respawn

`player-respawn` SHALL restore lives/ammo only for a dead player
(`alive === false`) whose current cell is the grid's `baseCellId`.
A respawn request from a live player SHALL be ignored — no state
change, no emit. A dead player outside `baseCellId` SHALL receive
`respawn-denied` with reason `not-at-base`.

#### Scenario: Respawn away from base rejected

- **WHEN** a dead player requests respawn outside the base cell
- **THEN** `respawn-denied` is emitted and state is unchanged

#### Scenario: Live player at base cannot respawn

- **WHEN** a player with `alive === true` requests respawn,
  regardless of position
- **THEN** the request is a no-op — lives, ammo, and `alive` are
  unchanged and neither `player-respawn` nor `respawn-denied` is
  emitted
