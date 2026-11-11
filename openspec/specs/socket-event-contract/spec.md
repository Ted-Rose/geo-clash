# Socket Event Contract Specification

## Purpose

Defines the Socket.io event surface shared by `client/` and `server/`:
event naming, the lobby ack handshake, the join/reconnect sequence,
per-`gameType` gameplay dispatch, and broadcast scoping. This is the
cross-layer seam — both workspaces MUST be updated together when it
changes.

## Requirements

### Requirement: Event naming

Events SHALL use kebab-case names (`location-update`, `grid-update`,
`player-attack`). Known snake_case exceptions in the snake game MUST be
preserved until deliberately renamed on both ends: `eat_food`,
`clash_ack`, `clash_verify`.

#### Scenario: New gameplay event added

- **WHEN** a new socket event is introduced
- **THEN** it is named in kebab-case and wired in both
  `server/src/**/socketHandlers.js` and the client listener/emitter

### Requirement: Lobby ack protocol

The client SHALL drive the lobby via `rooms-list`, `room-create`, and
`room-join`, each carrying a Socket.io ack callback that receives the
result (`{ rooms }`, `{ ok, room }`, or `{ ok: false, reason }`).
`room-leave` is fire-and-forget.

#### Scenario: Client requests the room list

- **WHEN** a socket emits `rooms-list` with an ack callback
- **THEN** the server invokes the callback with `{ rooms }` from the
  registry

#### Scenario: Join rejected

- **WHEN** `room-join` targets a missing or full room
- **THEN** the ack resolves `{ ok: false, reason }` (`no-such-room` or
  `room-full`; the `ended` reason branch exists but is unreachable —
  ended rooms are destroyed) and no state mutates

### Requirement: Join handshake sequence
On a fresh successful join the server SHALL emit `joined` and
`snapshot`, then broadcast `player-joined`. `sessionId` rejoins
re-key the stored player to the new socket and broadcast
`player-reconnected` (both games implement
`getPlayerBySessionId`/`swapSocketId`). A rejoin resolving to the
socket's own player SHALL be idempotent — no re-key or removal side
effects.

#### Scenario: Fresh join delivers full state
- **WHEN** a client's `room-join` ack resolves `{ ok: true }` for a new
  player
- **THEN** the socket receives `joined`, then `snapshot` containing the
  full game state, and other occupants receive `player-joined`

#### Scenario: Reconnect preserves identity
- **WHEN** `room-join` to a clash room carries a `sessionId` matching
  an existing player
- **THEN** the player record is re-keyed to the new socket id, a fresh
  `snapshot` is emitted, and the room sees `player-reconnected`

#### Scenario: Snake reconnect preserves identity
- **WHEN** `room-join` to a snake room carries a `sessionId` matching
  an existing player
- **THEN** the player record is re-keyed to the new socket id, a fresh
  `snapshot` is emitted, and the room sees `player-reconnected` — even
  when the room is at `maxPlayers`

#### Scenario: Same-socket rejoin is a no-op
- **WHEN** `room-join` carries a `sessionId` whose player is already
  keyed to the joining socket's own id and is still marked connected
- **THEN** the join resolves successfully without re-keying, the
  player record survives, and no `player-reconnected` is broadcast

#### Scenario: Same-socket rejoin after a disconnect restores presence
- **WHEN** `room-join` carries a `sessionId` whose player is keyed to
  the joining socket's id but was marked `connected: false` by a prior
  soft disconnect (e.g. after connectionStateRecovery restored the
  socket id)
- **THEN** the player record's `connected` flag is restored to `true`
  before the `snapshot` is emitted, and the room sees
  `player-reconnected`

### Requirement: Per-gameType handler dispatch
Gameplay handlers SHALL be registered only after a successful join,
selected by `gameType` (`clash` → `clash/socketHandlers.js`, `snake`
→ `snake/socketHandlers.js`), at most once per (socket, game
instance). Binding lives on a non-persisted socket property — a
recovered socket or a different room re-binds; leaving detaches.
`room-create` with an unsupported `gameType` MUST fail.

#### Scenario: Snake room gets snake handlers
- **WHEN** a socket joins a room whose `gameType` is `snake`
- **THEN** the snake event handlers (`location-update`, `eat_food`,
  `clash_ack`) are registered on that socket, not the clash ones

#### Scenario: Rejoin does not double-register
- **WHEN** a socket completes a second `room-join` for a room it is
  already a player in
- **THEN** each gameplay event on that socket is still handled exactly
  once per emit

### Requirement: Broadcast scoping

Game-state emissions SHALL be scoped to `io.to(roomId)` so
concurrent matches stay isolated. Per-player events
(`ammo-update`, `snake-reset`, `clash_verify`) MUST target the
individual socket id. Per-player emissions that fire after a
sessionId re-key — including timers scheduled before the swap —
MUST target the player's current socket id, not the id captured
at schedule time.

#### Scenario: Grid diff reaches only the room

- **WHEN** a clash tick emits `grid-update`
- **THEN** only sockets joined to that room receive it

#### Scenario: Ammo recharge survives reconnect

- **WHEN** an ammo recharge timer is scheduled for a player who
  then reconnects (sessionId re-key via `swapSocketId`) before
  `ammoRenewalMs` elapses
- **THEN** the recharge still fires, mutates the re-keyed player
  record, and `ammo-update` is emitted to the new socket id

### Requirement: Clock-sync round-trip

The server SHALL answer `time-sync` by echoing `clientSendMs` plus
`serverNowMs`, via the ack callback when present, else a `time-sync`
emit — so clients can estimate skew for projectile interpolation in a
single round-trip.

#### Scenario: Client measures skew

- **WHEN** a client emits `time-sync` with its send timestamp and an
  ack
- **THEN** the ack returns `{ clientSendMs, serverNowMs }`

### Requirement: Thin socket handlers

Socket handlers SHALL validate input shape and delegate to game-state
methods; they MUST NOT mutate gameplay state inline.

#### Scenario: Malformed location update ignored

- **WHEN** `location-update` arrives without numeric `lat`/`lng`
- **THEN** the handler returns without calling `updateLocation`
