# Tasks

## 1. Config and dependencies

- [ ] 1.1 both: Add `eslint`, `@eslint/js`, `globals`, and
  `eslint-plugin-react-hooks` as root devDependencies (pin a version
  published > 7 days ago); verify `npm install` succeeds and
  `package-lock.json` updates.
- [ ] 1.2 both: Create root `eslint.config.js` — recommended rules,
  Node globals for `server/**` (with `no-console: "off"`),
  browser globals + react-hooks for `client/**` (with
  `no-console: ["error", { allow: ["warn", "error"] }]` and
  `react-hooks/exhaustive-deps: "warn"`), ignore `node_modules`,
  `dist`, `terraform`, `openspec`; verify `npx eslint .` runs and
  reports a bounded finding list.

## 2. Scripts and findings

- [ ] 2.1 both: Add `"lint": "eslint ."` to root `package.json`;
  verify `npm run lint` exits non-zero on findings and zero when
  clean.
- [ ] 2.2 server: Fix server lint findings (expected: unused vars,
  redundant `eslint-disable` comments now covered by the `no-console`
  policy); verify `npm --prefix server test` still passes.
- [ ] 2.3 client: Fix client lint findings and remove redundant
  `eslint-disable-next-line no-console` comments; verify
  `npm --prefix client run build` and `npm --prefix client test`
  still pass.
- [ ] 2.4 both: Verify `npm run lint` exits 0 for the whole repo.

## 3. CI gate

- [ ] 3.1 both: Add a `lint` job to `.github/workflows/test.yml`
  (checkout → setup-node → `npm ci` at root → `npm run lint`); verify
  the workflow YAML is valid and the job appears in the PR checks.

## Workflow follow-up

- Archive the change after the project's review requirements are
  satisfied.
