# Proposal

## Why

`RoomRegistry.create` records hardcoded snake lobby defaults
(`foodCountTarget ?? 10`, `foodRespawnIntervalMs ?? 2000`,
`arenaSideMeters ?? 1000`) that diverge from the values
`SnakeGameState` actually defaults to (`5`, `2000`, `50`). When a client
creates a snake room without explicitly sending these fields, the lobby
list advertises values the game ignores.

## What Changes

- `server/src/roomRegistry.js`: construct the snake game first and read
  its effective `foodCountTarget`, `foodRespawnIntervalMs`,
  `arenaSideMeters`, and `timeLimitMs` back into meta instead of using
  local `??` fallbacks.
- `server/src/snake/gameState.js`: expose the effective constructor
  params as read-only getters so the registry never hardcodes them.
- `server/src/snake/constants.js`: add `ARENA_SIDE_M` so the `50` arena
  default has a named home alongside the other snake defaults.
- `client/src/components/LobbyScreen.jsx`: align the display fallback
  `r.arenaSideMeters ?? 1000` with the game's real default.
- `server/test/roomRegistry.test.js`: cover that a snake room created
  without explicit params reports the game's effective defaults.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `room-lifecycle`: adds a requirement that snake meta SHALL record the
  game instance's effective config values rather than registry-side
  defaults.

## Impact

Touches `server/` and `client/`. No socket event contract changes —
`rooms-updated`/`room-create` payloads keep the same shape; only the
recorded values change. No seeded spec contradicts the fix.
