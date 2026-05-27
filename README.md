# Park Wars — Real-Time Geo-Territory MVP

A mobile-first web app where players claim 5x5m squares of real-world territory by
standing in them, shoot arrows with a swing gesture, and shield with a circle gesture.
5-minute matches, most squares wins.

## Stack
- **Frontend:** React (Vite), TailwindCSS, React-Leaflet (OpenStreetMap tiles, no API key)
- **Backend:** Node.js, Express, Socket.io
- **State:** Pluggable `MemoryStore` (default `Map`, easy Redis/Valkey swap)

## Quick start

```bash
# from repo root
npm run install:all
npm run dev
```

- Client:  http://localhost:5173
- Server:  http://localhost:3001

The Vite dev server proxies `/socket.io` to the backend so a single URL works on phone.

## Mobile testing on LAN
Use your machine's LAN IP, e.g. `http://192.168.x.x:5173`. Geolocation requires either
`localhost` or HTTPS — for real GPS on a phone use a tunneling tool (ngrok / cloudflared)
or run vite with `--https` and accept the self-signed cert.

For desktop testing without GPS, use the **Simulate Movement** debug panel that ships in
the UI: it generates a fake position you can drag around the map and spawns bot
opponents that wander randomly.

## How to play
1. Open the app, allow location (or enable Simulate mode).
2. Pick the bounding area — defaults to a 120m square centered on you (~600 cells of 5x5m).
3. Stand inside a square for 5 seconds to paint it your color.
4. Tap **SWING** to shoot an arrow in your facing direction.
5. Tap **SHIELD** to absorb the next hit for 5s.
6. Out of lives? Walk to the **Base** marker and tap **RESPAWN**.
7. Most squares owned when the 5:00 timer hits 0 wins.

## Architecture notes
- `server/src/gridUtils.js` slices the bbox into ~5x5m cells using a local equirectangular
  approximation (good enough at small scales).
- `server/src/gameState.js` owns the authoritative state and a 200 ms tick that
  advances per-cell capture progress and broadcasts deltas.
- `server/src/memoryStore.js` is a tiny KV facade: swap the `Map` impl for `ioredis`
  by re-implementing `get/set/del/keys/all`.
