# Design

## Context

Post-merge review of PR #15 (module decomposition, commit `b1365ea`)
under the connectivity & trust model in `AGENTS.md`. The extraction is
clean; all findings below are pre-existing defects the refactor
exposed. See `proposal.md` for motivation and `specs/` for the
behavioral contract.

Relevant current code: `server/src/roomRegistry.js` (join/reconnect
path, `softDisconnect`), `server/src/clash/gameState.js` +
`combat.js`/`capture.js`/`lifecycle.js` (re-key, projectiles, scores,
teardown), `server/src/snake/gameState.js` + `clashHandshake.js`
(re-key, kill ACK, `eat_food`), `client/src/clash/GameScreen.jsx`
(debug bots), `client/src/shared/ProjectileLayer.jsx` (rAF loop).

## Goals / Non-Goals

**Goals:**
- Make `room-join` + `sessionId` idempotent and complete: same-socket
  rejoin is a no-op; a real re-key retargets every stored reference
  (projectiles, timers); handler registration is once-per-socket.
- Close the two offline-as-exploit vectors (snake kill-dodge,
  fabricated `eat_food`) while staying lenient to genuinely
  disconnected players.
- Fix score-reporting bugs and the client-side interval/rAF leaks.
- Trim per-tick redundant work so the Redis/Valkey store swap stays
  cheap.

**Non-Goals:**
- No new socket events, no payload-shape changes, no renames.
- No client-side offline game simulation — buffered-truth reporting is
  a separate future change; this only fixes the server-side
  reconciliation edges it will depend on.
- No timer/interval architecture changes beyond cancellation and
  emission-frequency fixes.

## Decisions

- **Same-socket rejoin → early return, twice.** Guard in
  `roomRegistry` (`existing.socketId === socket.id` → re-emit
  `joined`/`snapshot`, skip `swapSocketId` + handler registration) and
  a defensive `oldId === newId` early-return inside each game's
  `swapSocketId`. Alternative considered: rely only on the registry
  check — rejected, the game-level guard also covers any future
  caller.
- **Once-per-socket handlers → `socket.data.handlersRegistered`.**
  Each `register<Game>Handlers` sets the flag and no-ops if already
  set. Cheaper and more robust than diffing listener counts.
- **Projectile re-key in `swapSocketId`.** Iterate
  `projectileStore`, rewrite `attackerId` when it matches `oldId` —
  same pattern the existing code already uses for grid cells and ammo
  timers. Alternative: resolve by `playerId` instead of socket id —
  larger refactor, deferred.
- **Kill handshake: killer's ack is sufficient.** The victim's
  `clash_ack` becomes advisory; on window expiry the kill commits iff
  the killer acked. This directly implements "offline is never an
  advantage" — the victim's client is the only party with an
  incentive to stay silent. Alternative considered: keep voiding on
  victim disconnect but punish patterns — unenforceable at MVP scale.
  Trade-off accepted: a genuinely-dropped victim loses the kill it
  couldn't contest anyway; the 2000 ms window + reconnect grace still
  bounds abuse.
- **`eat_food` validation via `_recentlyEaten` as a real check.**
  The bookkeeping set already written (and purged after 3000 ms)
  becomes the leniency window: award iff `foodId` is live or in
  `_recentlyEaten`; ignore otherwise. Preserves the spec'd
  racing-claims behavior while blocking fabrication at zero extra
  state.
- **Scores: recount on roster change + pre-purge tally.** Clash:
  invalidate/recompute `_lastPlayersCache`-derived scores in
  `addPlayer`/`removePlayer` (or derive the tally inside
  `processCaptures` from the already-fetched lists). Snake: compute
  `finalScores` from `archived`/pre-purge players in `endMatch`.
- **Client leaks: `useRef` for bots, gated rAF.** Bots live in
  `botsRef`; the unmount effect iterates `botsRef.current` and clears
  intervals/sockets. `ProjectileLayer` starts its loop only when
  `projectiles.length > 0`.
- **Tick hygiene.** Fetch `playerStore.all()` once per tick and pass
  it into `processCaptures`; emit `timer` only when the integer
  second changes; snake `_tick` gets the same `console.error` catch
  as clash. Also declare `_projectileTimers`, `_lastPlayersCache`,
  `_lastCellsCache` in the constructor so the state surface is
  visible in one place.

## Risks / Trade-offs

- Killer-acked victim disconnect committing the kill could punish a
  victim who dropped *just* as the clash started → mitigated by the
  short 2 s window and the fact the victim's snake is
  client-authoritative only while connected; the kill was already
  server-detected.
- `_recentlyEaten` window still allows double-claim points for
  genuinely-racing clients → accepted per spec (unduplicated claims);
  tightening it further is a separate change.
- Hoisting the per-tick player list slightly restructures
  `capture.js`'s signature → internal only, no contract change.
