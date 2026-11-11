# Design

## Context

ESLint 9's flat-config format is now the default (`eslintrc` is
deprecated). The monorepo orchestrates everything from the root
(`npm run dev`, `npm test`), so a single root config matches existing
conventions better than per-workspace configs.

## Goals / Non-Goals

**Goals:**
- One `eslint.config.js` at root; `npm run lint` lints both workspaces
  plus root files.
- Server: `@eslint/js` recommended + Node globals, ES modules.
- Client: recommended + browser globals + `eslint-plugin-react-hooks`
  (the highest-value React lint surface; `react/react-in-jsx-scope`
  etc. from `eslint-plugin-react` is mostly obsolete with the modern
  JSX transform).
- CI runs lint on PRs.

**Non-Goals:**
- No Prettier/formatting rules (separate decision; ESLint alone will
  not enforce formatting).
- No `eslint-plugin-react` full ruleset, no import-order plugins, no
  TypeScript tooling.
- No mass code churn — findings fixed in place or explicitly
  suppressed with a reason.

## Decisions

- **Single root flat config, devDeps at root.** Alternatives:
  per-workspace configs (duplicated, drifts) or a shared
  `eslint-config-*` package (overkill for two workspaces). Root-level
  matches how `concurrently` already lives at root.
- **`no-console` policy:** allow `console.warn`/`console.error`
  globally (`no-console: ["error", { allow: ["warn", "error"] }]`) —
  server's `console.log` startup lines stay legal in `server/**` via a
  per-glob `no-console: "off"`. Client keeps the restriction (its only
  intentional logs are warns/errors, matching the existing disable
  comments, which then get deleted as redundant).
- **Hook deps:** `react-hooks/exhaustive-deps` starts as `warn`, not
  `error` — several effects intentionally omit deps; promoting to
  error later is a follow-up, not this change.
- **`node --test` globals** under `server/test/**` get `node:test`
  imports already, so only `test`'s implicit env is needed — no extra
  plugin.
- **CI:** add a `lint` job to `test.yml` (same file, parallel job,
  `npm ci` at root + `npm run lint`) rather than a second workflow —
  keeps the PR gate in one place. Depends on the WIP landing first;
  if it hasn't, add the job to `deploy.yml`? No — rebase onto the WIP
  instead; documented in tasks.

## Risks / Trade-offs

- [Lint flags real latent bugs (e.g. unused vars that were
  intentional)] → fix-forward small diffs; anything ambiguous gets an
  inline disable with a comment, flagged in the PR.
- [Config is opinionated and bikesheds] → deliberately minimal
  (recommended sets only); stricter rules are a later, separate
  proposal.
- [Root `npm ci` needed for the lint job adds CI time] → one extra
  install step; acceptable.
