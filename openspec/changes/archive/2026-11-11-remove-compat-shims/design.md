# Design

## Context

The repo already declared its target layout: `clash/`, `snake/`,
`shared/` per workspace. The server migration completed but left six
dead re-export files at `server/src/` root (verified: zero importers in
`src/` or `test/` — every test already uses the canonical
`shared/`/`clash/`/`snake/` paths). The client migration inverted the
direction: `src/clash/` and `src/shared/` exist but hold only 2-line
re-export shims pointing back at `components/`, `hooks/`, and
`socket.js`, which still contain all the real code.

## Goals / Non-Goals

**Goals:**
- Every module has exactly one canonical import path.
- `client/src/` matches the layout `AGENTS.md` and `openspec/config.yaml`
  already describe: `clash/`, `snake/`, `shared/`, plus `App.jsx`,
  `main.jsx`, `index.css` at root.
- `server/src/` root holds only real modules: `index.js`,
  `socketHandlers.js`, `roomRegistry.js`, `tileProxy.js`.

**Non-Goals:**
- No behavior, socket-event, or API changes.
- No further server relocation (e.g. moving `roomRegistry.js` into
  `shared/`); that is a separate decision.
- No client test suite introduction — verification is build + manual.

## Decisions

- **Move code into the shim locations rather than deleting the shim
  dirs.** The existing shim filenames already encode the intended
  target paths (`clash/GameScreen.jsx` re-exports
  `components/GameScreen.jsx`, etc.) — they are effectively a written
  spec of this refactor. Alternative considered: keep `components/` and
  delete the shim dirs; rejected because the per-game layout is the
  documented direction and snake already follows it.
- **Client target map:**

  | From | To |
  |---|---|
  | `components/GameScreen.jsx` | `clash/GameScreen.jsx` |
  | `components/ControlPanel.jsx` | `clash/ControlPanel.jsx` |
  | `components/HUD.jsx` | `clash/HUD.jsx` |
  | `components/PostMatchScreen.jsx` | `clash/PostMatchScreen.jsx` |
  | `components/ProjectileLayer.jsx` | `clash/ProjectileLayer.jsx` |
  | `components/SimPanel.jsx` | `clash/SimPanel.jsx` |
  | `components/MapView.jsx` | `shared/MapView.jsx` |
  | `components/LobbyScreen.jsx` | `shared/LobbyScreen.jsx` |
  | `hooks/useGeolocation.js` | `shared/hooks/useGeolocation.js` |
  | `hooks/useRooms.js` | `shared/hooks/useRooms.js` |
  | `hooks/useSound.js` | `shared/hooks/useSound.js` |
  | `socket.js` | `shared/socket.js` |

- **`LobbyScreen` goes to `shared/`**, not a new `lobby/` dir — it is
  game-agnostic and a single file does not justify a directory.
  Alternative considered: keep at root next to `App.jsx`; rejected —
  `shared/` is where cross-game UI lives.
- **Mechanics:** use `git mv` to preserve history; rewrite imports
  afterward (all imports are static, verified by grep — no dynamic
  `import()` in client). Notably `shared/hooks/*`'s existing
  `../socket.js` references stay valid unchanged (same relative depth).
- **Docs updated in the same change** — `AGENTS.md` and
  `openspec/config.yaml` describe the shim layer today; leaving them
  stale would re-introduce the confusion this removes.

## Risks / Trade-offs

- [Missed import rewrite breaks the build] → Vite fails on unresolved
  static imports, so `npm --prefix client run build` is a complete
  check; server side is covered by `node --test`.
- [Open PRs / branches conflict on moved files] → land this quickly on
  a dedicated branch; the change is mechanical and rebases cleanly.
- [`shared/hooks` vs `hooks` churn for snake imports] → trivial two-line
  rewrites in `snake/GameScreen.jsx`; accepted.
