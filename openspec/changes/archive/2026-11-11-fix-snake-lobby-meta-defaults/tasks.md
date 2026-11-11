# Tasks

- [x] server: add `ARENA_SIDE_M` to `server/src/snake/constants.js` and use it as the `arenaSideMeters` default in `SnakeGameState`
- [x] server: add read-only getters (`arenaSideMeters`, `foodCountTarget`, `foodRespawnIntervalMs`, `timeLimitMs`) to `SnakeGameState`
- [x] server: in `RoomRegistry.create`, construct the game before writing meta and read snake config back from the instance (drop `?? 10`/`?? 2000`/`?? 1000`)
- [x] client: align the `r.arenaSideMeters ?? 1000` display fallback in `LobbyScreen.jsx` to the real default
- [x] server: extend `server/test/roomRegistry.test.js` to assert snake meta mirrors the game's effective defaults; run `npm --prefix server test`
