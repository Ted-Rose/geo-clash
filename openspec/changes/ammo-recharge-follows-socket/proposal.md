# Proposal

## Why

`GameState._scheduleAmmoRecharge(playerId)`
(`server/src/clash/gameState.js`) captures the attacker's socket
id in the `setTimeout` closure and reuses it for both the
`playerStore` lookup and the scoped `ammo-update` emit. On a
sessionId reconnect, `swapSocketId` re-keys the player record
(new key written, old key deleted) but knows nothing about the
pending timer. When the timer fires, `playerStore.get(oldId)`
returns `undefined` and the callback early-returns: the ammo is
never recharged *and* the `ammo-update` emit would have targeted
the dead socket id anyway. A player who reconnects mid-match with
empty ammo can therefore be locked out of attacking for the rest
of the match. Flagged in `test-plans/clash-game.md` (review
finding #3).

## What Changes

- **server:** make the recharge timer follow the player's current
  socket id — `_ammoTimers` stores a mutable `{ playerId, handle }`
  record per timer, the callback resolves `record.playerId` at
  fire time, and `swapSocketId` rewrites `playerId` on records
  belonging to the swapped id. Recharging then mutates the
  re-keyed record and `ammo-update` reaches the live socket.
- **server tests:** add an ammo test covering
  attack → `swapSocketId` → recharge lands on the new key and
  `ammo-update` is scoped to the new socket id.

No socket events, payload shapes, or client code change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `socket-event-contract` — the "Broadcast scoping" requirement is
  extended: per-player emits that fire after a sessionId re-key
  MUST target the player's current socket id.

## Impact

- `server/src/clash/gameState.js`: `_ammoTimers` value shape,
  the recharge callback, `swapSocketId`, and the `endMatch`
  timer-sweep (now clears `record.handle`).
- `server/test/clash/ammo.test.js`: +1 regression test. The
  existing `lifecycle.test.js` assertions on
  `_ammoTimers.size` keep working — the map itself is unchanged.
- Verified by `npm --prefix server test`.
