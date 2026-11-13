# Design

## Context

The server is a single Cloud Run service (`geo-clash-server`,
Express + Socket.io, scale 0–1, `cpu_idle: true`). The client is
a Vite SPA currently built and hosted only by Vercel
(`vercel.json` rewrites `/api/map/tiles/*` to Cloud Run and all
other paths to `index.html`, plus per-path cache headers). The
client already supports same-origin operation: with
`VITE_SERVER_URL` unset, `src/shared/socket.js` uses `'/'` so
socket.io and `/api` calls hit the serving origin — this is also
how dev works behind the Vite proxy. See proposal.md for
motivation.

## Goals / Non-Goals

**Goals:**

- One Docker image serves API + socket.io + the built SPA.
- No new GCP resources, secrets, or env vars; `CORS_ORIGIN`
  unchanged (same-origin traffic needs no CORS allowance).
- Vercel deployment path untouched — it keeps building its own
  bundle with `VITE_SERVER_URL` set.
- Server still runs normally when no client build exists
  (local `npm --prefix server run dev`, tests).

**Non-Goals:**

- No custom domain, CDN, or load balancer for the fallback URL —
  `*.run.app` is the fallback address.
- No change to socket event contracts or gameplay logic.
- No second Cloud Run service, Firebase, or GCS bucket.

## Decisions

### Serve from Express, not a separate static service

`express.static` + a fallback GET handler inside the existing
app costs nothing at rest and reuses the same scale-to-zero
instance. Alternatives: a second Cloud Run service (extra
service surface for no benefit), Firebase Hosting (new
toolchain/deploy step), GCS static site (no HTTPS on the bucket
website endpoint, SPA fallback impossible without a ~$18/mo load
balancer).

### Multi-stage Dockerfile builds the client inside the image

Stage 1 (`node:20-alpine`): `npm ci` in `client/`, run
`pwa-assets` then `vite build` **without** `VITE_SERVER_URL` →
`dist/` baked for same-origin. Stage 2: the existing server
image plus `COPY --from=build /build/client/dist ./public` (or
similar fixed path). Building inside Docker keeps CI identical
(`docker build` is the only step) and guarantees the served
bundle always matches the deployed server commit.
Alternative considered: building the client in a separate CI
step and copying `dist` — rejected because it splits the build
across CI and Dockerfile and can drift.

### Build context moves to repo root

The Dockerfile needs `client/` and `server/`; the current
context (`./server`) can't see the client. `deploy.yml` changes
to `docker build -f server/Dockerfile -t … .` from the repo
root. Add a root `.dockerignore` (`**/node_modules`,
`client/dist`, `openspec`, `.git`, …) so the context stays
small and `client/dist` can't leak a stale local build into the
image.

### Static mount order and fallback shape

In `app.js`, after the `/api` routes and rate limiters:
`express.static(clientDist, { setHeaders })` then a final
`app.get('*', …)` sending `index.html` with no-store. Socket.io
attaches to the HTTP server and handles `/socket.io` before
Express middleware sees it, so no exclusion is needed there —
but the wildcard must still be GET-only and registered last so
`/api/*` and `/health` always win. `clientDist` resolved via
`import.meta.url` relative path; `fs.existsSync` gate keeps the
missing-build case a no-op.

Cache headers mirror `vercel.json`: `/assets/*` →
`public, max-age=31536000, immutable`; `index.html`, `/sw.js`,
`/workbox-*.js` → `no-cache, no-store, must-revalidate`;
`manifest.webmanifest` → `public, max-age=3600, must-revalidate`.
`Service-Worker-Allowed: /` is implicit since `sw.js` is served
from the root path.

### Reword the production warning in `socket.js`

The "not set for the production build … Vercel origin" warning
now has a legitimate same-origin production mode. Keep a warning
only where it is still meaningful (or reword to "connecting to
the serving origin"), so the Cloud Run–served console isn't
noisy. Behavior is unchanged.

## Risks / Trade-offs

- Single instance serves game + static files → under a large
  simultaneous first-load burst the game tick shares CPU with
  file serving. Mitigation: hashed assets are immutable-cached
  and the service worker caches tiles, so repeat traffic is
  near-zero; acceptable at MVP scale. Raising
  `max_instance_count` is deliberately out of scope (would break
  the single-process GameState assumption anyway).
- Docker image grows by the client bundle (a few MB) →
  negligible; Artifact Registry keeps 3 tags already.
- SPA fallback could shadow a route added later → register it
  strictly last and keep it GET-only; tests cover that `/api/*`
  still reaches its handlers.
- `sw.js` served from the same Cloud Run origin caches tiles
  under `map-tiles` — same-origin matcher already fits; no
  cross-origin caching risk introduced.
