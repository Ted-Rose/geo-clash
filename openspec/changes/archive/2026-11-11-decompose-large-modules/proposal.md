# Proposal

## Why

Four modules carry most of the codebase's complexity and keep growing:
`server/src/clash/gameState.js` (579 lines), `client` clash
`GameScreen.jsx` (508), `LobbyScreen.jsx` (492), and
`server/src/snake/gameState.js` (414). Each mixes several concerns —
match lifecycle, capture progression, projectile resolution, and ammo
timers in one; socket subscriptions, derived state, and rendering in
another — which makes reviews harder and merge conflicts more likely.
The snake module already demonstrates the intended pattern (logic
factored into `collisions.js`, `food.js`, `constants.js`), and the WIP
`server/src/app.js` extraction shows the same instinct on the client
agnostic side.

## What Changes

- **server:** split `clash/gameState.js` — extract the tick-time
  capture/occupancy progression into `clash/capture.js` and the
  attack/ammo/projectile-resolution lifecycle into `clash/combat.js`,
  leaving `GameState` as the orchestrator that owns stores, timers,
  and emits.
- **server:** split `snake/gameState.js` — extract the pending-clash
  ACK handshake (`clashAck`, `cancelClashesFor`, `_killPlayer`, the
  `_pendingClashes` map) into `snake/clashHandshake.js`, matching the
  existing `snake/` helper-module style (and the already-named
  `test/snake/clashHandshake.test.js`).
- **client:** extract the socket subscription + gameplay-state
  handling out of clash `GameScreen.jsx` into a `useClashGame` hook so
  the component is render + input only.
- **client:** split `LobbyScreen.jsx` into focused sibling components
  (room-create form, room list) under `shared/`.

Pure code motion — no behavior, socket-event, snapshot-shape, or API
changes. Declares `skip_specs`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — pure refactor, no spec-level behavior changes. Declared via
`skip_specs: true` in `.openspec.yaml`.

## Impact

- `server/src/clash/`: +2 modules (`capture.js`, `combat.js`),
  `gameState.js` shrinks to ~lifecycle + delegation.
- `server/src/snake/`: +1 module (`clashHandshake.js`).
- `client/src/clash/`: +1 hook (`useClashGame.js`);
  `client/src/shared/`: +1-2 lobby components.
- **Ordering:** should land after `remove-compat-shims` so edits touch
  the final file paths (`clash/`, `shared/` — not `components/`).
- Verified by the expanded test suites (220 server tests, client
  vitest) plus `npm --prefix client run build` and a manual smoke run.
