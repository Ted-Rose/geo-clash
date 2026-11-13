# Tasks

## 1. Server static serving

- [x] server: 1.1 In `server/src/app.js`, after the `/api` routes,
      add `express.static` for a client-dist dir (resolved
      relative to `import.meta.url`, e.g. `../public`) gated by
      `fs.existsSync`, plus a final GET-only SPA fallback sending
      `index.html`. Verify: with a build present, `GET /` and
      `GET /deep/link` return `index.html`; `GET /api/rooms`,
      `/api/map/tiles/…`, and `/health` still reach their
      handlers; without a build dir the app starts unchanged.
- [x] server: 1.2 Add cache headers matching `vercel.json`:
      `/assets/*` → `public, max-age=31536000, immutable`;
      `index.html`, `sw.js`, `workbox-*.js` →
      `no-cache, no-store, must-revalidate`;
      `manifest.webmanifest` → `public, max-age=3600,
      must-revalidate`. Verify via response headers in the new
      test.
- [x] server: 1.3 Add a `node --test` suite (e.g.
      `server/test/staticServing.test.js`) using an injected
      `buildServer` + a temp dist dir covering: root →
      `index.html`, deep link → `index.html`, hashed asset →
      immutable cache, `sw.js`/`index.html` → no-store, `/api/*`
      and `/health` unaffected, missing-dir → still starts.
      Verify: `npm --prefix server test` (or scoped `node
      --test`) passes.

## 2. Docker image

- [x] server: 2.1 Rewrite `server/Dockerfile` as multi-stage:
      stage 1 runs `npm ci` in `client/` + `npm run pwa-assets` +
      `npm run build` with `VITE_SERVER_URL` unset; stage 2 is
      the current server image + `COPY --from` the client `dist`
      to the path from 1.1. Verify: `docker build -f
      server/Dockerfile .` from repo root succeeds locally (or
      document the check if Docker is unavailable).
- [x] both: 2.2 Add a root `.dockerignore` excluding
      `**/node_modules`, `client/dist`, `.git`, `openspec`, and
      other non-build files. Verify: build context stays small
      and a stale local `client/dist` cannot leak into the
      image.

## 3. CI deploy workflow

- [x] both: 3.1 In `.github/workflows/deploy.yml`, change the
      docker build step to repo-root context: `docker build -f
      server/Dockerfile -t $IMAGE_BASE:$TAG .` Verify: the
      workflow file parses (actionlint/yamllint or CI run) and
      the push step is unchanged.

## 4. Client + docs

- [x] client: 4.1 Reword the production warning in
      `client/src/shared/socket.js` so same-origin production is
      a valid mode (e.g. warn only that it connects to the
      serving origin). Update `socket.test.js` expectations if
      the message text is asserted. Verify: `npm --prefix client
      test` passes.
- [x] both: 4.2 Update `README.md` (production deployment
      section: fallback URL, dual-frontend model) and
      `AGENTS.md` (architecture notes: server also serves the
      SPA; Docker context is repo root). Verify: docs describe
      the merged behavior accurately.
- [x] both: 4.3 Run `openspec validate --all --strict` and the
      scoped test suites; every line ≤ 79 chars in touched
      files. Verify: validation clean, suites green, no
      line-length violations introduced.

## Workflow follow-up

- Archive the change after the PR is merged and the deploy
  workflow is green.
- Verify the archived result and that
  `https://geo-clash-server-*.run.app` serves the SPA.
