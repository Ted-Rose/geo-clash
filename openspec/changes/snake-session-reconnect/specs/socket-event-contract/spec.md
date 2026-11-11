# Socket Event Contract Delta

## MODIFIED Requirements

### Requirement: Join handshake sequence

On a fresh successful join the server SHALL emit `joined` and
`snapshot` to the joining socket, then broadcast `player-joined`
to the room. Rejoins carrying a known `sessionId` re-key the
stored player to the new socket id and broadcast
`player-reconnected` instead — for every game implementing the
session interface (`getPlayerBySessionId`/`swapSocketId`; both
clash and snake do).

#### Scenario: Fresh join delivers full state

- **WHEN** a client's `room-join` ack resolves `{ ok: true }` for
  a new player
- **THEN** the socket receives `joined`, then `snapshot`
  containing the full game state, and other occupants receive
  `player-joined`

#### Scenario: Reconnect preserves identity

- **WHEN** `room-join` to a clash room carries a `sessionId`
  matching an existing player
- **THEN** the player record is re-keyed to the new socket id, a
  fresh `snapshot` is emitted, and the room sees
  `player-reconnected`

#### Scenario: Snake reconnect preserves identity

- **WHEN** `room-join` to a snake room carries a `sessionId`
  matching an existing player
- **THEN** the player record is re-keyed to the new socket id
  (including `acksNeeded` membership in any pending clash), a
  fresh `snapshot` is emitted, and the room sees
  `player-reconnected` — even when the room is at `maxPlayers`
