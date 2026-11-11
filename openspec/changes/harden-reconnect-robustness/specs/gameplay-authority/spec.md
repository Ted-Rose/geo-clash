# Spec Delta

## MODIFIED Requirements

### Requirement: Server-authoritative kill handshake
On a server-detected collision the server SHALL emit `clash_verify` to
every participant socket and commit the kill (`snake-hit` + targeted
`snake-reset` to the victim, +5 score/+1 kill to the killer) once the
killer answers `clash_ack` within 2000 ms. The victim's ack is
advisory: victim timeout or disconnect SHALL NOT void the kill — a
participant cannot dodge a committed kill by going silent. The clash
is cancelled only when the killer fails to ack inside the window.

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

### Requirement: Undeduplicated food claims
Every well-formed `eat_food` claim during an active match SHALL award
`FOOD_SCORE_PER_ITEM` to the reporter and emit `snake-ate` only when
the `foodId` is present in the live food list or was removed by
another claim inside the recent-claim window (3000 ms). Claims for ids
outside that set — fabricated or long-stale — SHALL be ignored with no
score change and no `snake-ate`. Legitimate claims are not
deduplicated: repeat claims for a just-removed id keep awarding points
within the window. Food is topped to target on a configurable interval
(default 2000 ms).

#### Scenario: Two clients eat the same food
- **WHEN** a second `eat_food` for the same `foodId` arrives after the
  first claim removed it
- **THEN** the second reporter still receives its point via `snake-ate`
  and no second `food-update` fires for that id

#### Scenario: Fabricated food id is ignored
- **WHEN** an `eat_food` claim arrives naming a `foodId` that is
  neither live nor inside the recent-claim window
- **THEN** no point is awarded and no `snake-ate` is emitted

## ADDED Requirements

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
