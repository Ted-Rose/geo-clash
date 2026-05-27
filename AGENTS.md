# Agent Onboarding — Geo Clash

A short, durable orientation for AI coding agents. Read this first before touching
the code. For human-facing usage, see `README.md`.

## What this project is
A mobile-first **real-time multiplayer territory game** played on top of a real-world
map. Players claim 5x5 m squares by standing in them, shoot arrows, raise shields,
respawn at a base cell. Matches are short (a few minutes). The MVP is purely a
**web app** — no native mobile code.

## Repo shape (monorepo, two workspaces)
```
/                 root: scripts that orchestrate both workspaces
/server           Node.js realtime backend (Express + Socket.io)
/client           React (Vite) + Leaflet frontend
```

Add new code in the workspace where it belongs. Avoid creating sibling top-level
folders unless introducing a genuinely new deployable.

## High-level architecture
- **Authoritative server.** All gameplay rules, timers, ownership, hit detection,
  and scoring live in `server/`. Clients are dumb renderers + input sources.
- **Transport.** Socket.io over WebSocket. Events are small JSON payloads named in
  `kebab-case` (`location-update`, `grid-update`, `player-attack`, …).
- **State store.** A small async KV facade (`server/src/memoryStore.js`) backs
  every persistent collection. Default impl is an in-process `Map`; it is designed
  to be swappable for Redis/Valkey **without changing call sites**. Preserve that
  contract.
- **Tick loop.** A single interval inside the game-state module advances per-cell
  capture progress, expires shields, decrements the match timer, and broadcasts
  diffs. Avoid spawning competing timers — extend the existing tick instead.
- **Geo math.** Bounding-box → grid slicing uses a local equirectangular
  approximation, which is fine at <1 km scales. Don't reach for full geodesics
  unless arenas grow significantly.

## Frontend conventions
- **Vite + React** function components, hooks only. No class components.
- **TailwindCSS** for styling. Prefer utility classes; don't introduce a CSS-in-JS
  layer.
- **Leaflet via `react-leaflet`** with OpenStreetMap tiles — **no API keys**. Keep
  it that way so localhost-only testing works.
- **Single source of truth** for gameplay state is the server snapshot + deltas;
  the client only holds derived/UI state (animations, transient effects, input
  buffers). Don't simulate gameplay on the client.
- **Mobile first.** All UI must work in a phone browser in portrait. Touch
  targets ≥ 44 px. The HUD overlays the map; never push the map below the fold.

## Backend conventions
- **ES modules** (`"type": "module"`). Top-level `await` is allowed in entrypoints.
- **Async-friendly store calls** even when the impl is sync (`await store.get(k)`)
  so swapping to Redis is a non-event.
- **No global singletons leaking across files** beyond the documented stores and
  the `GameState` instance constructed in the server entrypoint.
- **Socket handlers stay thin.** Validate input shape, delegate to game-state
  methods, never mutate state inline.

## Cross-cutting rules
- **Don't hardcode credentials, tokens, or production URLs.** This project must
  remain runnable on a fresh laptop with `npm install` + `npm run dev`.
- **Same-origin in dev** is enforced via the Vite proxy for `/socket.io`. Don't
  hardcode `http://localhost:3001` in client code — use the proxy.
- **Geolocation requires `localhost` or HTTPS** in browsers. Keep the
  Simulate-Movement debug path working so desktop development never depends on
  real GPS.
- **Mock/debug surfaces are first-class.** Any feature that depends on hardware
  (GPS, accelerometer, NFC, compass) must have a UI-button fallback.

## Common commands
```bash
npm run install:all      # install root + server + client
npm run dev              # run server and client together (hot reload)
npm --prefix server run dev
npm --prefix client run dev
npm --prefix client run build
```
Server default port: `3001`. Client dev server: `5173`. Both are configurable via
env if the need arises — don't bake new ports into multiple files.

## Git workflow
- Default working branch: `development`. `main` is for known-good states.
- Conventional-commit style messages (`feat:`, `fix:`, `chore:`, `refactor:`, …).
- Commit in small, themed steps; don't bundle unrelated changes.
- Never commit `node_modules`, build artifacts, secrets, or editor scratch files.
  Update `.gitignore` instead.

## When extending the game
Typical extension checklist:
1. Add/modify a Socket.io event in **both** `server/src/socketHandlers.js` and the
   client wiring.
2. Mutate authoritative state only inside the game-state module; broadcast a diff.
3. Update the snapshot payload if a new client needs to render the new field on
   first connect.
4. Add a debug/mock path so the feature is exercisable on desktop without
   hardware.
5. If you introduce a new persistent collection, add it as a `MemoryStore`
   instance — do **not** use a bare `Map` in business logic.

## Things to *not* do without explicit instruction
- Replace Leaflet/OSM with a keyed map provider (Google, Mapbox, …).
- Introduce a heavy state library (Redux, MobX, Zustand) for what local React
  state already handles.
- Add a database or ORM. The in-memory store is intentional for the MVP; the
  upgrade path is Redis-compatible, not Postgres-shaped.
- Convert the codebase wholesale to TypeScript in one PR — incremental `.ts`/`.d.ts`
  is fine if explicitly requested.
- Build native mobile (React Native, Capacitor, Cordova). This is a web app.

## Where to look first
- Game rules & tick → server game-state module.
- Geo helpers → server grid utils.
- Realtime wiring (server) → server socket handlers.
- Realtime wiring (client) → client `App.jsx` and `socket.js`.
- Map rendering → client `MapView` component.
- HUD / inputs → client `HUD`, `ControlPanel`, `SimPanel` components.

## Feature Development, Planning, & Branch Management Workflow
When instructed to implement a broader feature (anything requiring more than a
few lines of code or necessitating multiple Git commits for proper tracking),
strictly adhere to this multi-step workflow:

**1. Planning Phase**
Before writing any code, present a comprehensive implementation plan to the
user for approval. Write the approved plan into a Markdown file (e.g.,
`feature-plan.md`) at the project root. This file is the single source of
truth and checklist for the implementation.

**2. Branch Creation**
Once the plan is finalized, create and switch to a new branch from `main`
before making any code changes. Use a descriptive kebab-case name that
reflects the feature (e.g., `feature/user-authentication`).

**3. Incremental Implementation**
Implement the feature step-by-step, strictly following the plan. Make
frequent, atomic Git commits as each sub-task is completed. Each commit must
represent a single cohesive change with a clear, descriptive message.

**4. Review & Approval**
Do not merge upon completing the code. Present the finished implementation to
the user for final review and validation. Wait for explicit approval.

**5. Integration & Cleanup**
Once approved, perform all of the following in order:
- Delete the temporary Markdown plan file from the project directory.
- Squash-merge the development branch into `main` (one clean commit on `main`).
- Delete the temporary development branch.

---

Keep this file short. If it gets long, that's a smell — push detail into code
comments or `README.md`.
