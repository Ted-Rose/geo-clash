# Geo Clash

> **Capture the real world, one 5×5 m square at a time.**
> A mobile-first, real-time multiplayer territory game played on top of
> OpenStreetMap.

Open the app outdoors with a few friends, pick an area, and the world
gets sliced into a grid of 5×5 meter cells. Stand inside a cell for 5
seconds to paint it your color. Shoot arrows by swinging your phone.
Raise a shield by drawing a circle. Run out of lives? Return to base and
tap to respawn. Most squares when the 5-minute timer hits zero wins.

The MVP is a **pure web app** — no app store, no SDK, no API keys. You can
playtest it on a city block in five minutes.

## Tech stack
- **Frontend** — React (Vite), TailwindCSS, React-Leaflet on
  OpenStreetMap tiles
- **Backend** — Node.js, Express, Socket.io (authoritative server, real-time
  bidirectional state)
- **State** — Pluggable in-memory KV store with a Redis/Valkey-shaped
  contract, ready to swap when we outgrow a single process
- **Geo** — Local equirectangular grid math (no heavy GIS deps)

## Multi-room lobbies
Geo Clash now supports concurrent matches in independent rooms.

- On launch, the player lands on a **lobby** that lists every active room
  (`name`, `playerCount/maxPlayers`, `status`). Long-press / right-click on the
  in-game map drops a target marker for the deterministic-projectile attack.
- Anyone can create a new room with a name, max capacity (default 8), and a
  GPS-derived center point. Joining seeds the grid from the joiner's
  location if the room hasn't picked one yet.
- Matches are fully isolated: state, ticks, projectiles, and broadcasts are
  scoped per-room via Socket.io rooms.
- When the last player leaves a room (or the timer hits zero), the server
  archives final per-player scores to a capped leaderboard store, purges all
  runtime state, and removes the room.

REST endpoints exposed by the server:
- `GET  /api/rooms` — list active rooms
- `POST /api/rooms` — create one
  (`{ name, centerLat, centerLng, maxPlayers }`; rate-limited to
  20 creations / 10 min per IP — it's the only unauthenticated write)
- `GET  /api/leaderboard?limit=N` — all-time top-N (capped, sorted desc)

All `/api/*` responses carry `helmet` security headers and a generous
per-IP rate limit (300/min); map-tile requests are exempt — map pans
legitimately burst. Tile `z`/`y`/`x` params are range-validated (400 on
non-numeric or out-of-range coordinates).

## Projectile model
Attacks are committed by the server as small telemetry packets — `(origin,
target, vMps, tSpawn, tArrival)` — and every client interpolates the arrow
position locally. Clients run a one-shot `time-sync` round-trip to estimate
their clock skew so the projection stays aligned with the server. Late
joiners receive in-flight projectiles in the initial `snapshot` and pick up
exactly where the existing players are watching.

## Run it locally
```bash
npm run install:all
npm run dev
# client → http://localhost:5173
# server → http://localhost:3001
npm test    # run the server and client test suites
```
No GPS on desktop? Tick **Simulate Movement** in the UI and walk around with
WASD. Spawn bots from the same panel to fill the arena.

## Production deployment (Vercel + Cloud Run)
The client and server are deployed to **different origins**, so two env
vars are mandatory — without them, the realtime socket silently fails to
handshake and the *Enter the arena* button does nothing.

- **Vercel (client)** — set a Project env var:
  - `VITE_SERVER_URL = https://<your-cloud-run-service>.run.app`
  - It must be set for the *Production* (and *Preview*) build environment, then
    redeploy. Without it, socket.io connects to the Vercel origin, the SPA
    rewrite returns `index.html` for `/socket.io/...`, and the client stays
    forever in a "connecting" state with no thrown error.
- **Cloud Run (server)** — set:
  - `CORS_ORIGIN` — allowed browser origins, comma-separated
    (production: `https://geoclashers.vercel.app`). The server reflects
    them for both Express CORS and the Socket.io handshake. An entry
    may contain `*`, matching one hostname run (`[a-z0-9-]+`) — our
    Terraform default lists `https://geoclashers.vercel.app` plus
    `https://geo-clash-*-industr-analysers-projects.vercel.app` so
    this project's Vercel preview deployments keep working; drop the
    second entry if previews don't need socket access. A bare `*` as
    the *only* entry reflects every origin — fine for dev, never for
    prod; mixed into a list it is ignored with a warning.
  - In CI it comes from the `CORS_ORIGIN` GitHub Actions secret →
    `TF_VAR_cors_origin`; `terraform/variables.tf` carries the matching
    default. Keep the secret value in the same format (comma-separated,
    optional `*` wildcards).

### Map tiles
Tile requests are **same-origin** in every environment: in dev the Vite `/api`
proxy forwards them to the local server; in production a `vercel.json` rewrite
proxies `/api/map/tiles/*` to Cloud Run and lets Vercel's edge cache serve
them (upstream `s-maxage=2592000`). Only websockets/REST still go
cross-origin — `/socket.io` is intentionally *not* routed through Vercel.
If the Vercel project predates the default-on behaviour, enable **"Cache
external rewrite responses"** in the project dashboard once after merging.
The rewrite `destination` hardcodes our Cloud Run hostname — edit
`vercel.json` for other/self-hosted deployments.

## Why it might be fun to build
- Real-world gameplay without writing a single line of native code.
- Tight, satisfying core loop — capture, shoot, shield, respawn.
- Lots of room for taste: visual identity, sound, gestures, game modes,
  spectator views, leaderboards, team play, persistent rivalries…
- Honest physics-of-the-real-world constraints (GPS jitter,
  accelerometer noise, network latency) that make for genuinely
  interesting engineering problems.

## Want to help?
We'd love collaborators — designers, gameplay engineers, mobile testers, OSM
geeks, anyone who finds the idea fun.

- **Code contributions** — fork, branch off `development`, open a PR. Small,
  themed commits welcome. See `AGENTS.md` for the project's conventions.
- **Ideas / playtest reports** — open a GitHub Issue. Bug reports with a
  reproduction recipe are gold.
- **Field tests** — grab a friend, go outside, tell us what broke.

## Status
Early MVP. Core loop works end-to-end. Lots of polish, balancing, and feature
work ahead. Nothing is sacred yet — bring opinions.

## License
TBD (likely MIT). Until then, treat this as source-available; please ask before
shipping a fork commercially.
