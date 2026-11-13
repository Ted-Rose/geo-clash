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
progress only under a single color with ≥1 connected occupant.
Contested or all-disconnected cells are skipped but keep progress;
vacated cells lose it; a same-color claimant switch restarts
`elapsedMs` at 0. At 5 s the cell is claimed and a `grid-update` diff
broadcasts new owners + scores.

#### Scenario: Contested cell stalls

- **WHEN** players of different colors occupy the same cell on a tick
- **THEN** the cell accrues no progress that tick, but existing
  progress is preserved and resumes once a single color remains

#### Scenario: Claimant leaves mid-capture

- **WHEN** a cell has `progress` but its occupants leave before 5 s
- **THEN** progress resets to null and no ownership change is emitted

#### Scenario: Same-color claimant switch restarts progress

- **WHEN** a cell has `progress` from player A and only teammate B
  occupies it on a tick
- **THEN** `elapsedMs` restarts at 0 under B's `playerId`

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
On a server-detected collision the server SHALL emit `clash_verify`
to every participant. A kill with a killer commits (`snake-hit` +
targeted `snake-reset`, +5 score/+1 kill) once the killer answers
`clash_ack` within 2000 ms; a late ack is treated as expired. The
victim's ack is advisory — victim silence or disconnect SHALL NOT
void the kill. Killerless kills (`killerId: null`) SHALL commit at
detection without any ack.

#### Scenario: Both sides ACK
- **WHEN** every participant of a pending clash sends `clash_ack`
  inside the window
- **THEN** the victim's score/tail reset and the killer is credited

#### Scenario: Victim silence cannot dodge the kill
- **WHEN** the killer acks inside the window but the victim times out
  or disconnects
- **THEN** the kill still commits — the victim's score/tail reset and
  the killer is credited

#### Scenario: Unresponsive participant voids the kill
- **WHEN** the 2000 ms window lapses with the killer's ack outstanding
- **THEN** the pending clash is dropped and no kill commits

#### Scenario: Mutual head-on kills commit immediately
- **WHEN** a server-detected collision produces kills with no killer
  (mutual head-on-head)
- **THEN** each kill commits at detection — `snake-hit` and a targeted
  `snake-reset` fire per victim with no `clash_ack` required — and a
  victim's silence or disconnect cannot void it

### Requirement: Undeduplicated food claims
A well-formed `eat_food` claim SHALL award `FOOD_SCORE_PER_ITEM` and
emit `snake-ate` only when the `foodId` is live or was removed inside
the recent-claim window (3000 ms); other ids SHALL be ignored with no
score change. Claims are not deduplicated within the window. Food is
topped to target on a configurable interval (default 2000 ms).

#### Scenario: Two clients eat the same food
- **WHEN** a second `eat_food` for the same `foodId` arrives after the
  first claim removed it
- **THEN** the second reporter still receives its point via `snake-ate`
  and no second `food-update` fires for that id

#### Scenario: Fabricated food id is ignored
- **WHEN** an `eat_food` claim arrives naming a `foodId` that is
  neither live nor inside the recent-claim window
- **THEN** no point is awarded and no `snake-ate` is emitted

### Requirement: Score broadcasts reflect the live roster
Score payloads SHALL be computed against the current player set — a
departed player SHALL NOT linger in `grid-update` scores — and
`match-end` SHALL carry the real final tally computed before per-room
state is purged.

#### Scenario: Departed player drops out of scores
- **WHEN** a clash player leaves a match while scores are being
  reported via `grid-update`
- **THEN** subsequent `grid-update` payloads omit the departed player

#### Scenario: Snake match-end reports final scores
- **WHEN** a snake match ends
- **THEN** `match-end.scores` contains each final player's tally,
  computed before `playerStore` is purged

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


### Requirement: Spawn grace expires

A snake player SHALL be collision-safe — unable to be killed or to
kill via tail/head contact — only while within `SPAWN_GRACE_MS`
(3000 ms) of its `spawnedAt` timestamp. Once the window lapses the
player SHALL collide normally; grace state SHALL NOT persist beyond
the window regardless of tick ordering.

#### Scenario: Respawned player is vulnerable after the window

- **WHEN** a snake player respawned more than `SPAWN_GRACE_MS` ago
  collides head-on with an enemy or contacts an enemy tail
- **THEN** the collision resolves normally — the player can be killed
  and can kill

#### Scenario: Inside the window the player is still safe

- **WHEN** a snake player within `SPAWN_GRACE_MS` of `spawnedAt` is
  checked for collisions
- **THEN** it neither dies nor kills via that check
