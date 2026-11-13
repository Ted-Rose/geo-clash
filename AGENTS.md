# Agent Onboarding — Geo Clash

A short, durable orientation for AI coding agents. Read this
first before touching the code. For human-facing usage, see
`README.md`.

## What this project is
A mobile-first **real-time multiplayer territory game** played on top of a
real-world
map. Players claim 5x5 m squares by standing in them, shoot arrows, raise
shields,
respawn at a base cell. Matches are short (a few minutes). The MVP is purely a
**web app** — no native mobile code.

## Repo shape (monorepo, two workspaces)
```
/                 root: scripts that orchestrate both workspaces
/server           Node.js realtime backend (Express + Socket.io)
/client           React (Vite) + Leaflet frontend
```

Add new code in the workspace where it belongs. Avoid creating sibling
top-level
folders unless introducing a genuinely new deployable.

## High-level architecture
- **Server-arbitrated, client-reporting.** All gameplay rules, timers,
  ownership, hit detection, and scoring live in `server/`. While
  connected, clients are dumb renderers + input sources; while
  disconnected they keep playing locally and report their truth on
  reconnect (see "Connectivity & trust model" below).
- **Transport.** Socket.io over WebSocket. Events are small JSON payloads named
  in
  `kebab-case` (`location-update`, `grid-update`, `player-attack`, …). Snake
  keeps
  three legacy snake_case events (`eat_food`, `clash_ack`, `clash_verify`)
  until a
  deliberate both-ends rename.
- **State store.** A small async KV facade
  (`server/src/shared/memoryStore.js`)
  backs every persistent collection. Default impl is an in-process `Map`;
  it is
  designed
  to be swappable for Redis/Valkey **without changing call sites**. Preserve
  that
  contract.
- **Tick loops.** Each per-game state module (`server/src/clash/gameState.js`,
  `server/src/snake/gameState.js`) runs its own interval —
  clash drives capture
  progress/shield expiry/match timer; snake relays updates and runs a second
  food-respawn interval. Avoid spawning competing timers —
  extend the existing ticks instead.
- **Geo math.** Bounding-box → grid slicing uses a local equirectangular
  approximation, which is fine at <1 km scales. Don't reach for full geodesics
  unless arenas grow significantly.
- **The Cloud Run image also serves the built client.** The multi-stage
  `server/Dockerfile` (build context = repo **root**, `docker build -f
  server/Dockerfile .`) builds `client/` without `VITE_SERVER_URL` and
  copies `dist` to `server/public` in the image; `app.js` serves it
  (SPA fallback, vercel.json cache headers) when the dir exists. The
  `*.run.app` URL is the fallback entry point if Vercel is down; local
  `server/` runs stay API-only since `server/public` doesn't exist.
- **Map tiles are always same-origin** (`/api/map/tiles/...`) — dev resolves
  them via the Vite `/api` proxy, production via a `vercel.json` external
  rewrite to Cloud Run (Vercel edge cache, `s-maxage` on the upstream
  response). Socket.io still connects cross-origin via `VITE_SERVER_URL`;
  never route `/socket.io` through Vercel. The generated service worker
  caches tile GETs in a bounded `map-tiles` runtime cache (`CacheFirst`,
  2000 entries / 30 days) — offline coverage is whatever areas the device
  has already viewed; the matcher is a `sameOrigin` callback and never
  caches cross-origin tile responses.

## Frontend conventions
- **Vite + React** function components, hooks only. No class components.
- **TailwindCSS** for styling. Prefer utility classes; don't introduce a
  CSS-in-JS
  layer.
- **Leaflet via `react-leaflet`** with OpenStreetMap tiles — **no API keys**.
  Keep
  it that way so localhost-only testing works.
- **Single source of truth while connected** is the server snapshot +
  deltas; the client otherwise holds only derived/UI state
  (animations, transient effects, input buffers). The exception is
  offline play — see "Connectivity & trust model".
- **Mobile first.** All UI must work in a phone browser in
  portrait. Touch targets ≥ 44 px. The HUD overlays the map;
  never push the map below the fold.

## Backend conventions
- **ES modules** (`"type": "module"`). Top-level `await` is allowed in
  entrypoints.
- **Async-friendly store calls** even when the impl is sync (`await
  store.get(k)`)
  so swapping to Redis is a non-event.
- **No global singletons leaking across files** beyond the documented stores
  and
  the `GameState` instance constructed in the server entrypoint.
- **Socket handlers stay thin.** Validate input shape, delegate to game-state
  methods, never mutate state inline.

## Connectivity & trust model
The game is played on phones moving through a real-world arena on
consumer Wi-Fi — **disconnects are routine, not exceptional**. Keep
this model in mind for every gameplay change:

- **No lost progress.** A player who drops off Wi-Fi and returns keeps
  locally-earned progress. The client buffers its own truth
  (positions, captures, attacks) while offline and reports it on
  reconnect; the server reconciles rather than hard-rejecting.
- **Clients report, server reconciles.** Each client is the source of
  truth for *its own* offline actions; the server stays the arbiter
  that merges competing claims (same-cell captures, hits registered
  while one side was offline).
- **Fair to the disconnected.** Resolve collisions with common sense —
  don't let an online player trivially overwrite what a
  briefly-offline player earned. Prefer timestamps and grace windows
  over "last write wins" or "online always wins".
- **Offline is never an advantage.** Disconnecting must not be a cheat
  vector: no dodging deaths by going dark, no retroactive claims
  contradicting what online players already saw. When in doubt, pick
  the interpretation a cheater couldn't abuse.
- **Size everything for flaky mobile links.** Prefer small deltas over
  resending full snapshots, keep reconnect/resync cost bounded, and
  don't let a stalled socket block tick loops or other players.

## Cross-cutting rules
- **Don't hardcode credentials, tokens, or production URLs.** This project must
  remain runnable on a fresh laptop with `npm install` + `npm run dev`.
- **GCP Secret Manager stays minimal.** Runtime secrets are Terraform-managed
  (`terraform/main.tf`). Never add a new `google_secret_manager_secret` per
  credential — consolidate into one shared env-file-style secret (KEY=VALUE
  lines) and append keys there; each extra secret adds cost.
- **`CORS_ORIGIN` is Terraform/secret-managed.** The GitHub Actions
  `CORS_ORIGIN` secret feeds `TF_VAR_cors_origin` at deploy — exported
  only when non-empty, so a missing secret can't blank the
  `terraform/variables.tf` default (the production allowlist:
  comma-separated origins; a `*` inside an entry matches one hostname
  run `[a-z0-9-]+` for Vercel previews). Keep the secret value in the
  same format — the server parses it via `parseCorsOrigin`; unset or
  empty fails closed (same-origin only, never reflect-all).
- **HTTP hardening lives in `server/src/app.js`.** `helmet()` headers
  (`crossOriginResourcePolicy: cross-origin` so self-hosted tile loads
  via `<img>` keep working), a per-IP `/api` rate limit (tiles exempt —
  bursts are normal), a tighter cap on `POST /api/rooms`, and
  `trust proxy 1` for Cloud Run's X-Forwarded-For. Tile `z`/`y`/`x`
  params are int-range-validated. The socket `room-create` event is
  capped at `MAX_ROOMS_PER_SOCKET` (5) creates per connection in
  `server/src/socketHandlers.js` — the real spam vector, since the
  event is unauthenticated.
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
npm test                 # run server (node --test) + client (vitest) suites
```
Server default port: `3001`. Client dev server: `5173`. Both
are configurable via env if the need arises — don't bake new
ports into multiple files.

## Conventions / rules

Universal rules — follow exactly:

1. **Max 79 chars per line, every file type.** Verify:
   `awk 'length > 79 {print FILENAME":"NR}' <file>`. Fix
   violations you introduce plus long lines in files already
   being modified. Exempt: formatter output (e.g. Prettier at
   printWidth 80 may emit 80-char lines) and vendored upstream
   skill files under `.agents/skills/` and `.devin/skills/`
   (`openspec-*`, `vercel-react-best-practices/`) — refresh
   tools own them.
2. **Commit format** `Type: Capitalized message` —
   `Feat:`/`Fix:`/`Docs:`/`Refactor:`/`Test:`/`Chore:`.
3. **Commit on feature branches only, never `main`.**
   Name branches `<type>/<slug>` with the commit types
   (`feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`).
   Stage only files changed this session, by path — never
   `git add -A`, `git add .` or `git commit -a`; confirm the
   staged set with `git status` first; leave the user's own
   dirty files alone; never commit plan/scratch markdown.
4. **Dangerous commands — never run** the destructive/deploy
   commands listed under "Repo-specific rules" below; write
   the change and tell the user the command to run instead.
5. **Scoped verification** — run only the tests/checks for
   what you changed, not the whole suite.
6. **PR bodies go to a temp file** + `gh pr create
   --body-file`, never inline `--body`; delete the temp file
   after. See `.devin/skills/create-pr/`.
7. **Every PR body includes a UI verification / QC section** —
   concrete steps (pages, clicks, expected result) exercising
   the change end-to-end through the UI. Omit only when
   genuinely unreachable from the UI — then give an
   equivalent (curl command, log line, file to inspect).
8. **GitHub remote targeting**: when `origin` is the user's
   fork (an `upstream` remote exists), ALL GitHub operations
   — issues, PRs, comments, releases — target the fork via
   `--repo <owner>/<fork>`; never upstream unless asked.
   Otherwise `origin` is the target.
9. **No secrets in code.** Secrets live in gitignored local
   files / env vars / GCP Secret Manager. Never create new
   Secret Manager secrets — append KEY=VALUE lines to the
   shared `env-file` secret (each extra secret adds cost).
10. **Update docs after functionality changes** — this file
    and the repo's other contract docs (README /
    DEVELOPER_GUIDE / docs/*) — in the same change.
11. **`docs/plans/` is frozen** — existing files stay as
    history with their status headers (implemented / partial /
    in progress / not implemented / reverted); nothing new is
    added there or anywhere else — all new planning goes
    through OpenSpec (`openspec-propose` for changes,
    `openspec-explore`/change artifacts for investigations).
12. **This file is self-updating.** Missing tool → tell the
    user what to install instead of grinding through failing
    alternatives. Discovered flow/local quirk → write it into
    the relevant AGENTS.md and commit that doc update
    alongside the work that discovered it.

### Repo-specific rules

- **Dangerous commands — never run**: `terraform apply` or any
  mutating `gcloud` command (infra is Terraform-managed);
  `git push` to `main` (work lands via squash-merge PRs).
  There is no DB migration tool — schema changes are code
  changes.
- **GitHub targeting**: `origin` = `Ted-Rose/geo-clash` (the
  user's own repo) — all `gh` operations target it.
- **`main` is the default + integration branch** — work lands
  via squash-merge PRs; delete the working branch after
  merge. `development` is a stale legacy branch (the repo
  converged on `main`) — do not target it.
- **Work in a git worktree, never the main checkout** —
  `git fetch origin`, then `git worktree add
  ../geo-clash-worktrees/<slug> -b <type>/<slug>
  origin/main` and do all work (commits, push, PR) inside it.
  The main checkout may hold the user's uncommitted work or
  another agent's session; never switch branches there.
  Finishing a task means a green, agent-reviewed PR — never
  ask the
  user whether to open one. After pushing: open the PR ready
  for review (NEVER a draft) per `.devin/skills/create-pr/`,
  then run a review loop — spawn a FRESH reviewer subagent on
  the diff, fix everything useful it reports, push, and
  repeat with a new reviewer until a round finds nothing
  meaningful. Once the loop is clean and the PR's checks are
  green, clean up IMMEDIATELY — don't wait for the merge
  (the PR lives on the remote branch; removing the local
  worktree/branch does
  not touch it, and the remote branch is deleted at merge
  time). From the main checkout: `git worktree remove
  ../geo-clash-worktrees/<slug>` + `git branch -D
  <type>/<slug>` (`-D`, not `-d` — squash-merges leave the
  branch "unmerged"). Abandoned work gets the same cleanup;
  follow-up requests get a FRESH worktree — never reuse an
  old one. Goal state: `git worktree list` shows only the
  main checkout when the task ends. Each worktree needs its
  own `npm run install:all` (`node_modules` is gitignored).
- **Commit style switched to `Type: Capitalized`** (rule 2) —
  older history uses lowercase conventional commits; do not
  rewrite it.
- **PRs are reviewed by the user before merge** — present the
  PR URL and wait for explicit approval; do not self-merge.
- **Test login**: none — the game has no auth system.
- Commit in small, themed steps; never commit `node_modules`,
  build artifacts, secrets, or editor scratch files — extend
  `.gitignore` instead.
- Never create plan/feature-plan Markdown files — planning goes
  through OpenSpec (rule 11).

## When extending the game
Typical extension checklist:
1. Add/modify a Socket.io event in **both** the matching
   `server/src/<game>/socketHandlers.js` (dispatched by `gameType` from
   `server/src/socketHandlers.js`) and the client wiring.
2. Mutate authoritative state only inside the per-game game-state module
   (`server/src/clash/` or `server/src/snake/`); broadcast a diff.
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
- Convert the codebase wholesale to TypeScript in one PR — incremental
  `.ts`/`.d.ts`
  is fine if explicitly requested.
- Build native mobile (React Native, Capacitor, Cordova). This is a web app.

## Where to look first
- Game rules & ticks → `server/src/clash/gameState.js` and
  `server/src/snake/gameState.js`.
- Geo helpers → `server/src/shared/gridUtils.js`.
- Realtime wiring (server) → `server/src/socketHandlers.js` (lobby +
  dispatch) and `server/src/<game>/socketHandlers.js` (gameplay).
- Realtime wiring (client) → client `src/App.jsx` and
  `src/shared/socket.js`.
- Map rendering → client `src/shared/MapView.jsx`.
- HUD / inputs → client `src/clash/` (`HUD`, `ControlPanel`, `SimPanel`)
  and `src/snake/` components. The shared in-game burger menu (Leave +
  player list) is `src/shared/GameMenu.jsx` — per-game menu items go in
  its `children` slot.

## OpenSpec

`openspec/` at the repo root is the spec-driven planning layer (npm
`@fission-ai/openspec`, v1.14.x). `openspec/specs/` holds capability
specs describing CURRENT code-verified behavior (source of truth);
`openspec/changes/` holds proposed changes (`proposal.md`, `design.md`,
`tasks.md`, delta `specs/`) that merge into `specs/` on archive.

- Run `openspec` commands from the repo root where `openspec/` lives.
- The CLI is a global npm install under `/opt/homebrew/bin` —
  not on agent-shell PATH (see the machine-environment notes
  in `~/.config/devin/AGENTS.md`).
- Always run `openspec validate --all --strict` after touching
  `openspec/`; it must pass before committing.
- `tasks.md` items MUST be prefixed `server:`, `client:`, or `both:` to
  name the target workspace (`both:` for changes that must land
  together, e.g. a new socket event and its client wiring).
- Workflow skills live in `.devin/skills/openspec-*` (frontmatter
  stripped to `name`/`description` for Devin discovery). The
  `.agents/skills/openspec-*/` originals are upstream artifacts owned by
  `openspec update` — keep them verbatim; re-copy + re-strip the
  `.devin` copies after each update.
- Workflow: `openspec-propose` → implement via `openspec-apply-change`
  → `openspec-archive-change`. Archive in the implementing PR when
  feasible; otherwise archive immediately after merge on `main`. Never
  leave a merged change unarchived.
- Any change that alters behavior covered by `openspec/specs/` MUST
  update the affected spec in the same PR — whether via an archived
  delta or a direct spec edit.
- When to use it: features, contract changes, anything a reviewer would
  ask "why?" about. Skip the ceremony for bug fixes restoring spec'd
  behavior, typos, config/dep bumps, and tests.

---

Keep this file short. If it gets long, that's a smell — push detail into code
comments or `README.md`.
