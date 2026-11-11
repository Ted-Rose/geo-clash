# Tasks

## 1. Gate respawn on `!alive`

- [x] 1.1 server: Add `if (p.alive) return;` in `respawn()` in
  `src/clash/gameState.js`, after the `!p` guard and before the
  grid/base-cell checks; verify `npm --prefix server test` passes.
- [x] 1.2 server: Rewrite `test/clash/players.test.js` "respawn
  while already alive still resets lives" → rename to reflect the
  no-op, assert `lives` stays unchanged and neither
  `player-respawn` nor `respawn-denied` is emitted; remove the
  exploit-documenting comment; verify
  `node --test test/clash/players.test.js` passes.

## Workflow follow-up

- Archive the change after the project's review requirements are
  satisfied.
