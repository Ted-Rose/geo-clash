# Tasks

## 1. Server shim removal

- [x] 1.1 server: Delete `src/gameState.js`, `src/gridUtils.js`,
  `src/projectiles.js`, `src/memoryStore.js`, `src/roomLock.js`,
  `src/valkeyStore.js`; verify `grep -rn "from '.*\.\./\(gameState\|
  gridUtils\|projectiles\|memoryStore\|roomLock\|valkeyStore\)\.js'"
  src test` returns nothing and `npm --prefix server test` still
  passes.

## 2. Client relocation

- [x] 2.1 client: Delete the six `src/clash/*.jsx` shim files, then
  `git mv` the real clash components (`GameScreen`, `ControlPanel`,
  `HUD`, `PostMatchScreen`, `ProjectileLayer`, `SimPanel`) from
  `components/` into `clash/`; verify the files land and git records
  renames.
- [x] 2.2 client: Delete the four `src/shared/` shim files, then
  `git mv` `MapView.jsx` and `LobbyScreen.jsx` into `shared/`,
  `hooks/*.js` into `shared/hooks/`, and `socket.js` into
  `shared/socket.js`; verify `components/`, `hooks/`, and root
  `socket.js` no longer exist.
- [x] 2.3 client: Rewrite imports — `clash/GameScreen.jsx` and
  `snake/GameScreen.jsx` (`../socket.js` → `../shared/socket.js`,
  `../hooks/*` → `../shared/hooks/*`, `./MapView.jsx` →
  `../shared/MapView.jsx`), `shared/LobbyScreen.jsx` and
  `shared/MapView.jsx` (`../socket.js` → `./socket.js`, `../hooks/` →
  `./hooks/`), `App.jsx` (component paths to `clash/` and `shared/`);
  verify `npm --prefix client run build` succeeds and a repo-wide grep
  for `components/` or `src/hooks/` imports returns nothing.

## 3. Docs and stale artifacts

- [x] 3.1 both: Update `AGENTS.md` and `openspec/config.yaml` context
  to describe the final layout without the shim caveat; delete
  `feature-plan.md`; verify `openspec validate --all --strict` passes.

## Workflow follow-up

- Archive the change after the project's review requirements are
  satisfied.
