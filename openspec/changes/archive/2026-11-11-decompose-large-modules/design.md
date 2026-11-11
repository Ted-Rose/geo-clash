# Design

## Context

See proposal.md for the target files. The established pattern in this
repo is: one orchestrating class/component per game module, with
focused helper modules alongside (`snake/collisions.js`,
`snake/food.js`, `snake/constants.js`; `server/src/app.js` split from
`index.js` in the WIP). This change extends that pattern to the four
largest files rather than introducing a new architecture.

## Goals / Non-Goals

**Goals:**
- Each resulting module has a single, nameable responsibility.
- No exported-signature or payload changes visible outside the files.
- Line-count guidance, not a hard cap: no module over ~300 lines after
  the split.

**Non-Goals:**
- No architectural rewrite (no event bus, no classes composed via DI
  containers, no new state library on the client).
- `roomRegistry.js` (321 lines) stays — it is already one cohesive
  concern; splitting it is not justified.
- No behavior fixes piggy-backed onto the moves; the `_scores()` cache
  coupling in clash `gameState.js` is noted but left for a separate
  bug fix.

## Decisions

- **Server extraction style: module functions taking the game state,
  not new classes.** `capture.js`/`combat.js`/`clashHandshake.js`
  export async functions called as `await processCaptures(this, now,
  dt)` from `GameState`. Alternatives considered: (a) composed
  manager classes (`ProjectileManager`, `CaptureEngine`) — rejected:
  bigger churn, splits store ownership across objects, and no second
  consumer exists to justify the abstraction; (b) leaving methods in
  place and only extracting free helpers — rejected: the method groups
  themselves are the bulk.
- **clash split boundaries:**
  - `clash/capture.js`: the occupancy map, capture-progress updates,
    contested-cell skip, stale-progress purge, and the score recount /
    `_scores` helpers — everything inside `tick()` between the shield
    sweep and the `players-update` emit.
  - `clash/combat.js`: `attack`, `_scheduleAmmoRecharge`,
    `_scheduleResolution`, `_resolveProjectile` — one lifecycle
    (fire → recharge → resolve) sharing `projectileStore` and the
    timer maps.
- **snake split boundary:** `snake/clashHandshake.js` owns
  `_pendingClashes` and its three entry points (initiate from
  collision detection, `clashAck`, `cancelClashesFor`, `_killPlayer`).
  The name mirrors `test/snake/clashHandshake.test.js`.
- **Client `useClashGame` hook:** owns every `socket.on`/`socket.off`
  subscription, the snapshot-apply path, and the gameplay-state
  setters; returns the derived render state to `GameScreen.jsx`.
  Keeps "client is a dumb renderer" — no game logic moves into the
  hook, only event wiring.
- **Lobby split:** `RoomCreateForm` (create-room fields + submit) and
  `RoomList` (fetch/refresh/join rows) as siblings of
  `shared/LobbyScreen.jsx` — no new directories for two components.

## Risks / Trade-offs

- [Subtle emit-order changes from reordering code inside `tick()`] →
  extract whole contiguous blocks verbatim; the 220-test server suite
  covers capture, combat, and lifecycle paths.
- [Hook extraction hides which state is server-driven vs local] →
  hook returns a flat render-state object; no gameplay derivation
  beyond what the component already did.
- [Merge conflicts with the in-flight test-coverage WIP] → land after
  the WIP merges; conflicts are textual, not semantic.
