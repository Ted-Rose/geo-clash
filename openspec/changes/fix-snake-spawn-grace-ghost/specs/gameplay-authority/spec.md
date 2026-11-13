# Spec Delta

## ADDED Requirements

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
