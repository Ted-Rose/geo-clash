# Spec Delta

## Purpose

Lets the backend serve the production client build from the same
origin as the API and socket.io, so the app remains usable when the
primary static host (Vercel) is unavailable.

## ADDED Requirements

### Requirement: Server serves the client build
When a client build directory is present at startup, the server
SHALL serve the single-page app's `index.html` and its static
files over HTTP GET on the same origin as the API and socket.io.

#### Scenario: Root page load
- **WHEN** a client requests `GET /` on the backend origin
- **THEN** the response is `index.html` with status 200

#### Scenario: Static asset load
- **WHEN** a client requests `GET` for a file that exists in the
  build output (e.g. a hashed `/assets/*.js`)
- **THEN** the file is served with the correct content type

### Requirement: SPA fallback for client-side routes
The server SHALL return `index.html` for GET requests whose path
is not an API route, not a socket.io handshake, and not an
existing static file, so client-side routing works on refresh
and deep links.

#### Scenario: Deep link refresh
- **WHEN** a client requests `GET /some/client/route` that matches
  no file or API route
- **THEN** the response is `index.html` with status 200

#### Scenario: API routes are not swallowed
- **WHEN** a client requests `GET /api/rooms` or a tile under
  `/api/map/tiles/`
- **THEN** the API handler responds — the SPA fallback never
  intercepts `/api/*`, `/socket.io/*`, or `/health`

### Requirement: Cache headers match the static host contract
The server SHALL send cache headers equivalent to the Vercel
deployment: hashed assets immutable long-cache, `index.html` and
`sw.js` not cached, `manifest.webmanifest` short-cache.

#### Scenario: Hashed asset caching
- **WHEN** a client requests a file under `/assets/`
- **THEN** the response carries
  `Cache-Control: public, max-age=31536000, immutable`

#### Scenario: Entry point and service worker not cached
- **WHEN** a client requests `/` (i.e. `index.html`) or `/sw.js`
- **THEN** the response carries
  `Cache-Control: no-cache, no-store, must-revalidate`

### Requirement: Static serving is optional at runtime
When no client build directory exists at startup (local dev,
tests, a server-only image), the server SHALL run exactly as
before — API and socket.io unaffected, no startup failure.

#### Scenario: Missing build directory
- **WHEN** the server starts without a client build present
- **THEN** it starts successfully and API/socket routes behave
  unchanged

### Requirement: Fallback build uses same-origin networking
The client build bundled into the server image SHALL be produced
without `VITE_SERVER_URL`, so socket.io and `/api` calls target
the serving origin and require no CORS allowance.

#### Scenario: Same-origin socket connect
- **WHEN** the bundled client is loaded from the backend origin
- **THEN** its socket.io handshake and `/api` fetches go to that
  same origin (no `VITE_SERVER_URL` baked in)
