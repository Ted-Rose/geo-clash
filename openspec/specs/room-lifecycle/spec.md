# Room Lifecycle Specification

## Purpose

Defines how `RoomRegistry` (`server/src/roomRegistry.js`) creates,
populates, reconnects, and tears down concurrent matches. Rooms are
the isolation unit: each holds one game-state instance, one Socket.io
room, and one `rooms:meta` record indexed in `rooms:index`.

## Requirements

### Requirement: Locked mutations

Create/join/leave SHALL run inside `RoomLock` (per-room key,
`'create'` for creates) so concurrent lobby actions cannot race.
`destroy` is deliberately NOT lock-wrapped: `RoomLock` local locks are
non-reentrant, `leave`/`softDisconnect` already invoke it inside the
caller's lock, and the `onEnd` callback path calls it unlocked.

#### Scenario: Two joins race for the last seat

- **WHEN** two sockets join a room at `maxPlayers - 1` concurrently
- **THEN** the lock serializes them and the second join may be rejected
  `room-full`

### Requirement: Room creation

`registry.create` SHALL mint a ULID room id, persist meta (`name`,
`status: 'lobby'`, `playerCount: 0`, `maxPlayers` default 8,
`gameType` default `clash`, optional center/game params), construct
the game via its factory, and broadcast `rooms-updated`. Supplying
`centerLat`/`centerLng` SHALL pre-seed the grid/arena.

#### Scenario: Create with a center point

- **WHEN** `room-create` carries numeric `centerLat`/`centerLng`
- **THEN** the room's grid (clash) or arena (snake) is initialized at
  creation rather than on first `location-update`

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

### Requirement: Match start on first join

The first successful join SHALL start the match when the game instance
is still in `lobby` status (`match-start` broadcast). `meta.status` is
written once at create (`'lobby'`) for lobby-listing purposes and never
transitions — the `ended` join-reject branch is dead code, since ended
rooms are destroyed and joins then fail `no-such-room`.

#### Scenario: Lobby room activates

- **WHEN** a player joins a room still in `lobby` status
- **THEN** `startMatch` runs and the room broadcasts `match-start`

### Requirement: Disconnect grace period

`softDisconnect` SHALL mark the player `connected: false`, emit
`player-disconnected`, and schedule a hard leave after a grace window —
30 s, or remaining match time + 30 s during an active match. A
`sessionId` rejoin inside the window cancels the timer — both games
implement the session interface (`getPlayerBySessionId`/`swapSocketId`),
so the stored player is re-keyed to the new socket instead of being
hard-left.

#### Scenario: Mobile reconnect within grace

- **WHEN** a clash socket disconnects mid-match and rejoins with its
  `sessionId` before the grace timer fires
- **THEN** the player record is re-keyed to the new socket, its cells
  and progress are preserved, and `player-reconnected` is broadcast

#### Scenario: Snake reconnect preserves the player

- **WHEN** a snake player rejoins with its `sessionId` inside the grace
  window
- **THEN** the player record is re-keyed to the new socket, its score,
  tail, and pending-clash references are preserved, and
  `player-reconnected` is broadcast

#### Scenario: Grace expiry removes the player

- **WHEN** the grace timer fires with no rejoin
- **THEN** a hard leave runs: player removed, `player-left` broadcast,
  `playerCount` decremented

### Requirement: End-of-match teardown

`endMatch` SHALL archive every player's final score to the leaderboard
store (`metric` = `squares` for clash, `kills` for snake), purge all
per-room stores, broadcast `match-end` with scores + leaderboard, then
trigger `destroy` via the `onEnd` callback. `destroy` also runs when
`playerCount` reaches 0: it evicts lingering sockets, deletes meta and
index entries, and broadcasts `rooms-updated`.

#### Scenario: Timer expiry tears down the room

- **WHEN** the clash match timer reaches zero
- **THEN** scores are archived, runtime state is purged, `match-end` is
  broadcast, and the room is removed from the listing

### Requirement: Startup purge of stale state

`registry.init()` SHALL run once at startup before accepting
connections, deleting any room meta/index entries a previous process
left in Valkey.

#### Scenario: Server restarts against shared Valkey

- **WHEN** the server boots with `VALKEY_URL` set and stale
  `rooms:*` keys exist
- **THEN** `init()` clears the index and metas so ghost rooms never
  appear in the lobby
