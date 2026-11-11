# Design

## Context

Clash player records are keyed by socket id — there is no stable
internal player id. `swapSocketId(oldId, newId)` performs the
re-key in `playerStore` and remaps `gridStore` ownership/progress,
but `_ammoTimers` (`Map<key, timeoutHandle>`) is invisible to it.
The recharge closure captures `playerId` at schedule time, so a
reconnect between `attack` and the `ammoRenewalMs` tick strands
the timer: store lookup misses, ammo stays spent, emit targets a
dead socket.

## Goals / Non-Goals

**Goals:**
- Ammo recharge scheduled before a reconnect still fires, mutates
  the re-keyed player record, and emits `ammo-update` to the new
  socket id.
- No change to recharge timing — a swapped timer keeps its
  remaining delay rather than restarting `ammoRenewalMs`.

**Non-Goals:**
- No stable player-id refactor (e.g. keying `playerStore` by
  `sessionId`) — a much larger change touching every lookup.
- No projectile-resolution changes — `_resolveProjectile` keys by
  projectile id, not socket id, and its `attackerId` comparison
  only excludes the attacker from victims; a swapped attacker is
  unaffected.

## Decisions

- **Mutable timer record resolved at fire time.**
  `_ammoTimers.set(key, { playerId, handle })`; the timeout
  callback does `playerStore.get(rec.playerId)` /
  `io.to(rec.playerId)`. `swapSocketId` iterates `_ammoTimers`
  and sets `rec.playerId = newId` where `rec.playerId === oldId`.
  Alternatives considered:
  (a) reschedule timers in `swapSocketId` — rejected: needs a
      `fireAt` field to preserve remaining delay, more code for
      the same result;
  (b) capture `sessionId` and look the player up via
      `getPlayerBySessionId` at fire time — rejected: `sessionId`
      is nullable (`addPlayer` stores `sessionId || null`), and
      the lookup is an O(n) `playerStore.all()` scan per recharge;
  (c) leave as-is, document — rejected: this is the bug.
- **`endMatch` sweep updated in place.** It currently calls
  `clearTimeout` on raw handles; it now clears `rec.handle`. The
  `lifecycle.test.js` `_ammoTimers.size` assertions are unaffected
  (map key/count unchanged).
- **Sweep cost is trivial.** `_ammoTimers` holds at most a handful
  of entries per room (one per in-flight recharge); iterating it
  inside `swapSocketId` — itself an O(grid) operation — is free.

## Risks / Trade-offs

- [A second `swapSocketId` (double reconnect) misses timers] →
  handled: records whose `playerId` was already rewritten to the
  intermediate id match the next swap's `oldId` and get rewritten
  again.
- [Reconnect between two rapid attacks schedules timers on both
  ids] → both records converge on the current socket id; each
  fires independently and each legitimately restores +1 ammo.
