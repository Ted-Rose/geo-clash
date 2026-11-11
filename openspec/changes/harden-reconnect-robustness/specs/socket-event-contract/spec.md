# Spec Delta

## MODIFIED Requirements

### Requirement: Join handshake sequence
On a fresh successful join the server SHALL emit `joined` and
`snapshot` to the joining socket, then broadcast `player-joined` to
the room. Rejoins carrying a known `sessionId` re-key the stored
player to the new socket id and broadcast `player-reconnected`
instead — both games implement the session interface
(`getPlayerBySessionId`/`swapSocketId`). A rejoin that resolves to the
socket's *own* existing player SHALL be idempotent: the record is left
keyed as-is and no re-key or removal side effects occur.

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
  keyed to the joining socket's own id
- **THEN** the join resolves successfully without re-keying, the player
  record survives, and no `player-reconnected` is broadcast

### Requirement: Per-gameType handler dispatch
Gameplay handlers SHALL be registered only after a successful join,
selected by the room's `gameType` via a handler map (`clash` →
`clash/socketHandlers.js`, `snake` → `snake/socketHandlers.js`), and
at most once per socket — repeat joins, including same-socket session
rejoins, MUST NOT stack duplicate listeners. `room-create` with an
unsupported `gameType` MUST fail.

#### Scenario: Snake room gets snake handlers
- **WHEN** a socket joins a room whose `gameType` is `snake`
- **THEN** the snake event handlers (`location-update`, `eat_food`,
  `clash_ack`) are registered on that socket, not the clash ones

#### Scenario: Rejoin does not double-register
- **WHEN** a socket completes a second `room-join` for a room it is
  already a player in
- **THEN** each gameplay event on that socket is still handled exactly
  once per emit
