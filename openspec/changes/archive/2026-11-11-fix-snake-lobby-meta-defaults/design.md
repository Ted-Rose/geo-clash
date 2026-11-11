# Design

## Context

`RoomRegistry.create` builds the meta record before the game instance,
duplicating snake defaults (`?? 10`, `?? 2000`, `?? 1000`) that
`SnakeGameState`'s constructor already owns (`FOOD_COUNT_TARGET`,
`FOOD_RESPAWN_INTERVAL_MS`, literal `50`). The duplication drifted.
See proposal.md — Why.

## Goals / Non-Goals

**Goals:**
- Single source of truth: snake defaults live in
  `server/src/snake/constants.js`; meta reflects the constructed game.
- Meta can never diverge from the game's effective values again.

**Non-Goals:**
- Changing the actual default values (50 m arena, 5 food, 2 s respawn).
- Changing the `rooms-updated`/`room-create` payload shapes.

## Decisions

- **Read meta back from the constructed game.** Create the game first,
  then record `game.arenaSideMeters`, `game.foodCountTarget`,
  `game.foodRespawnIntervalMs`, `game.timeLimitMs` in meta via new
  read-only getters on `SnakeGameState`. Alternative considered: have
  the registry import `FOOD_COUNT_TARGET` etc. and re-apply `??`
  fallbacks — rejected, because it still duplicates the fallback logic
  and can drift again if the constructor rules change (e.g.
  `timeLimitMs` clamping).
- **`ARENA_SIDE_M` constant.** The arena default was a bare `50` in the
  constructor; move it to `constants.js` beside `FOOD_COUNT_TARGET` so
  all snake defaults are named.
- **Client fallback alignment.** `LobbyScreen.jsx` keeps a `??` display
  fallback for metas persisted before this fix (or older clients);
  align it to `50`, the real default.

## Risks / Trade-offs

- [Clash meta has no snake fields, so read-back must stay inside the
  `gameType === 'snake'` spread] → keep the conditional spread; getters
  only exist on `SnakeGameState`.
- [Constructor arg `undefined` still flows to `SnakeGameState`, which
  applies its own defaults] → desired: the game is authoritative.
