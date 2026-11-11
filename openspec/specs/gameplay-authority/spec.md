# Gameplay Authority Specification

## Purpose

Defines which side owns each piece of game truth. Clash is fully
server-authoritative; snake deliberately splits authority — each client
owns its own snake while the server owns food and all kill decisions.
The client MUST NOT simulate game rules beyond its snake-local state.

## Requirements

### Requirement: Clash tick loop

A single interval (200 ms) SHALL drive capture progress, shield
expiry, and the match timer — no competing timers. A cell accrues
progress only while occupied by a single color of connected players;
contested or vacated cells lose progress. At 5 s elapsed the cell is
claimed and a `grid-update` diff broadcasts new owners + scores.

#### Scenario: Contested cell stalls

- **WHEN** players of different colors occupy the same cell on a tick
- **THEN** the cell accrues no capture progress

#### Scenario: Claimant leaves mid-capture

- **WHEN** a cell has `progress` but its occupants leave before 5 s
- **THEN** progress resets to null and no ownership change is emitted

### Requirement: Deterministic projectiles

`player-attack` SHALL make the server commit a telemetry packet
`(origin, target, vMps, tSpawn, tArrival)` — targets beyond
`ATTACK_RANGE_M` are clamped; without a `target` the server picks the
nearest enemy inside a 25° cone. Resolution is server-scheduled at
`tArrival`: `hit` (nearest enemy within hit radius, -1 life, 0 lives →
dead), `blocked` (active shield), or `expired`.

#### Scenario: Shielded victim blocks the shot

- **WHEN** a projectile resolves against a victim whose shield is
  active at `tArrival`
- **THEN** outcome `blocked` is broadcast and no life is lost

### Requirement: Base-cell respawn

`player-respawn` SHALL restore lives/ammo only when the player's
current cell is the grid's `baseCellId`; otherwise the server emits
`respawn-denied` with reason `not-at-base`.

#### Scenario: Respawn away from base rejected

- **WHEN** a dead player requests respawn outside the base cell
- **THEN** `respawn-denied` is emitted and state is unchanged

### Requirement: Snake authority split

Each snake client SHALL be authoritative for its own snake —
`location-update` carries client-owned `tailPoints` and `score` which
the server stores and relays as-is via `snake-update` (500 ms tick).
The server owns the food list, its replenishment interval, and every
kill decision.

#### Scenario: Client relays its tail

- **WHEN** a snake client emits `location-update` with `tailPoints`
- **THEN** the server stores them verbatim and relays them to peers on
  the next `snake-update`

### Requirement: Server-authoritative kill handshake

On a server-detected collision the server SHALL emit `clash_verify` to
every participant socket and commit the kill (`snake-hit` + targeted
`snake-reset` to the victim, +5 score/+1 kill to the killer) only after
ALL participants answer `clash_ack` within 2000 ms. Timeout or
participant disconnect cancels the clash — no ghost kills.

#### Scenario: Both sides ACK

- **WHEN** every participant of a pending clash sends `clash_ack`
  inside the window
- **THEN** the victim's score/tail reset and the killer is credited

#### Scenario: Unresponsive participant voids the kill

- **WHEN** the 2000 ms window lapses with an outstanding ack, or a
  required participant disconnects
- **THEN** the pending clash is dropped and no kill commits

### Requirement: Tolerant food claims

`eat_food` SHALL award the point to the reporting player and remove the
food on the first claim; a duplicate claim inside a 3000 ms race window
still awards the point (lag tolerance) without double-removing.
Food is topped back to its target on a 2000 ms interval and every
change broadcasts `food-update`.

#### Scenario: Two clients eat the same food

- **WHEN** a second `eat_food` for the same `foodId` arrives within the
  race window
- **THEN** the second reporter still receives its point via `snake-ate`
