# Proposal

## Why

`GameState.respawn()` (`server/src/clash/gameState.js`) never checks
`p.alive`. Every other combat-adjacent verb guards on it —
`updateLocation`, `activateShield`, and `attack` all early-return
for dead players — but `respawn` only verifies the caller exists,
the grid is initialized, and the player stands in `baseCellId`.
Since `addPlayer` spawns everyone at the base-cell center, a live
player who never leaves the base can invoke `player-respawn`
repeatedly: each call resets `lives` to 3 and refills `ammo` to
`maxAmmo`, an indefinite heal-without-dying exploit. The suite even
pins it — `test/clash/players.test.js` "respawn while already alive
still resets lives" carries an inline comment flagging the
behavior as a possible exploit.

## What Changes

- **server:** gate `respawn()` on `!p.alive` — a request from a
  live player becomes a silent no-op, matching the style of the
  existing `!p` and `!this.grid` early returns. Dead players keep
  the current base-cell check and `respawn-denied` semantics,
  unchanged.
- **server tests:** invert the pinning test in
  `server/test/clash/players.test.js` to assert the no-op (lives
  unchanged, no `player-respawn` emit) and remove the
  exploit-documenting comment.

No socket events, payload shapes, or client code change. The
`player-respawn` / `respawn-denied` contract is untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gameplay-authority` — the "Base-cell respawn" requirement gains
  the `!alive` gate: respawn restores only dead players; requests
  from live players are ignored.

## Impact

- `server/src/clash/gameState.js`: a ~2-line guard in `respawn()`.
- `server/test/clash/players.test.js`: one pinning test inverted.
- Verified by `npm --prefix server test`.
