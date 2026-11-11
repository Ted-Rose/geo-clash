# Proposal

## Why

The repo has no lint configuration anywhere, yet the source is
peppered with `// eslint-disable-next-line no-console` comments —
dead markers for a tool that does not exist.
`.github/workflows/test.yml` gates PRs on tests but nothing checks
style, obvious bugs (unused vars, missing deps in React hooks), or
the existing `no-console` intent. Adding ESLint closes that gap and
makes the existing disable comments meaningful again.

## What Changes

- Add a single root `eslint.config.js` (flat config) covering both
  workspaces with per-glob overrides: Node globals + recommended rules
  for `server/`, browser globals + `react-hooks` recommended rules for
  `client/`.
- Add `eslint`, `@eslint/js`, `globals`, and `eslint-plugin-react-hooks`
  as **root** devDependencies; add a root `npm run lint` script (and
  per-workspace passthroughs if trivially cheap).
- Fix or suppress whatever the new config flags — expected to be small
  (unused vars, `no-console` decisions, hook-deps warnings).
- Remove now-unneeded `eslint-disable` comments where the chosen
  `no-console` policy makes them redundant; keep them only where a
  deliberate exception remains.
- Add a lint job (or step) to `.github/workflows/test.yml` so PRs are
  gated on lint as well as tests.

No runtime behavior, socket events, or APIs change. Tooling-only
change — declares `skip_specs`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — tooling only, no spec-level behavior changes. Declared via
`skip_specs: true` in `.openspec.yaml`.

## Impact

- Root `package.json`: new devDependencies + `lint` script.
- New `eslint.config.js` at repo root.
- `.github/workflows/test.yml`: new lint job.
- Source edits limited to lint findings (dead disables, unused vars,
  hook dep arrays) — no logic changes intended.
- Depends on nothing else; independent of `remove-compat-shims` and
  `decompose-large-modules` (though landing after them avoids
  re-linting moved files).
