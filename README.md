# Park Wars

> **Capture the real world, one 5×5 m square at a time.**
> A mobile-first, real-time multiplayer territory game played on top of OpenStreetMap.

Open the app outdoors with a few friends, pick an area, and the world gets sliced
into a grid of 5×5 meter cells. Stand inside a cell for 5 seconds to paint it your
color. Shoot arrows by swinging your phone. Raise a shield by drawing a circle.
Run out of lives? Return to base and tap to respawn. Most squares when the
5-minute timer hits zero wins.

The MVP is a **pure web app** — no app store, no SDK, no API keys. You can
playtest it on a city block in five minutes.

## Tech stack
- **Frontend** — React (Vite), TailwindCSS, React-Leaflet on OpenStreetMap tiles
- **Backend** — Node.js, Express, Socket.io (authoritative server, real-time
  bidirectional state)
- **State** — Pluggable in-memory KV store with a Redis/Valkey-shaped contract,
  ready to swap when we outgrow a single process
- **Geo** — Local equirectangular grid math (no heavy GIS deps)

## Run it locally
```bash
npm run install:all
npm run dev
# client → http://localhost:5173
# server → http://localhost:3001
```
No GPS on desktop? Tick **Simulate Movement** in the UI and walk around with
WASD. Spawn bots from the same panel to fill the arena.

## Why it might be fun to build
- Real-world gameplay without writing a single line of native code.
- Tight, satisfying core loop — capture, shoot, shield, respawn.
- Lots of room for taste: visual identity, sound, gestures, game modes,
  spectator views, leaderboards, team play, persistent rivalries…
- Honest physics-of-the-real-world constraints (GPS jitter, accelerometer noise,
  network latency) that make for genuinely interesting engineering problems.

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
