# Proposal

## Why

Both workspaces adopted a per-game directory layout (`clash/`, `snake/`,
`shared/`) but the migration stopped halfway. On the server, six
root-level re-export shim files linger with zero importers. On the
client it is worse: the "new" directories (`src/clash/`, `src/shared/`)
contain only re-export shims pointing *back* at `src/components/`,
`src/hooks/`, and `src/socket.js` — the real code was never moved. The
result is a split-brain layout where the intended structure exists only
as forwarding files, every "where does this module live" question has
two answers, and `openspec/config.yaml` + `AGENTS.md` have to document
the shim layer as a caveat.

## What Changes

- **server:** delete the six dead re-export shims
  (`src/gameState.js`, `src/gridUtils.js`, `src/projectiles.js`,
  `src/memoryStore.js`, `src/roomLock.js`, `src/valkeyStore.js`).
  Nothing in `src/` or `test/` imports them.
- **client:** move the real modules into the intended layout the shims
  already describe — clash UI out of `components/` into `clash/`, and
  `MapView`, `hooks/*`, `socket.js`, `LobbyScreen` into `shared/` —
  then delete the shim files and update every import site.
- **docs:** update `AGENTS.md` and the `openspec/config.yaml` context
  block so they describe the canonical layout instead of the shim
  caveat; delete the stale root `feature-plan.md` (already documented
  as a historical artifact).

No runtime behavior, socket events, REST endpoints, or store contracts
change. This is a pure relocation/deletion refactor.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — no spec-level behavior changes (pure refactor). Declared via
`skip_specs: true` in `.openspec.yaml`.

## Impact

- `server/src/`: 6 files deleted. `index.js`, `socketHandlers.js`,
  `roomRegistry.js`, `tileProxy.js` stay at root as real modules.
- `client/src/`: ~11 files relocated; imports updated in `App.jsx`,
  `snake/*`, and the moved clash components. `components/`, `hooks/`,
  and root `socket.js` disappear.
- Docs: `AGENTS.md`, `openspec/config.yaml` context text;
  `feature-plan.md` deleted.
- No dependency, API, or socket-contract impact. Verified by
  `npm --prefix server test` and `npm --prefix client run build`.
