# Proposal

## Why

The production frontend lives only on Vercel. If Vercel is down or
the project is migrated, there is no fallback entry point even
though the Cloud Run backend stays up. Serving the built client
from the existing Cloud Run Express app gives a zero-added-cost
fallback URL (`*.run.app`) with no new services or secrets.

## What Changes

- The server Docker image becomes multi-stage: it builds
  `client/` (`pwa-assets` + `vite build`, no `VITE_SERVER_URL`) and
  ships `client/dist` inside the same image as the server.
- `server/src/app.js` serves the static SPA (after `/api` and
  health routes) with a client-side-routing fallback to
  `index.html`, mirroring the `vercel.json` cache headers.
- The deploy workflow builds the image with the repo root as the
  Docker build context instead of `./server`.
- Same-origin operation: the bundled build connects socket.io and
  `/api` to the serving origin, so `CORS_ORIGIN` and Vercel are
  untouched.
- Docs updated (README, AGENTS.md) with the fallback URL and
  the dual-frontend model.

## Capabilities

### New Capabilities
- `static-client-serving`: The backend can serve the production
  client build (assets, SPA fallback, cache headers) from the
  same origin as the API and socket.io.

### Modified Capabilities
<!-- None — socket contract and gameplay behavior are unchanged;
     the same client build simply gains a second serving origin. -->

## Impact

- **Workspaces**: both — `server/` gains static serving and a
  multi-stage Dockerfile; `client/` is built inside the image but
  its source contract (`VITE_SERVER_URL` optional → same-origin)
  is already in place and needs no change beyond the existing
  production warning copy in `src/shared/socket.js`.
- **Socket event contract / seeded specs**: not affected — no
  event, state, or gameplay rule changes.
- **CI/CD**: `.github/workflows/deploy.yml` build context changes
  from `./server` to repo root (`-f server/Dockerfile`).
- **Infra/cost**: no Terraform changes, no new Cloud Run service,
  no new secrets. Serving adds per-request usage on the existing
  scale-to-zero service only.
- **Hardware-dependent features**: none added — no mock/debug
  fallback required.
