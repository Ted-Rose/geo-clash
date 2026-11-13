# Design

## Approach

Mirror the guard `softDisconnect` already applies in its miss branch:

```js
async leave(roomId, socket) {
  // inside the room lock:
  const p = await game.playerStore.get(socket.id);
  if (!p) {
    const sessionId = socket.data?.sessionId;
    if (sessionId
      && typeof game.getPlayerBySessionId === 'function') {
      const rekeyed = await game.getPlayerBySessionId(sessionId);
      if (rekeyed && rekeyed.socketId !== socket.id) return;
    }
    // no re-keyed record: fall through to normal removal side
    // effects (player-left broadcast, playerCount decrement,
    // room destroy) — removePlayer itself is a no-op on miss.
  }
  // ... existing removal + side effects
}
```

Key decisions:

- **Check the record, not just the session.** The guard lives in the
  miss branch only; a live record under `socket.id` leaves normally.
- **Grace timer passes `sessionId`.** The fake socket in
  `softDisconnect` gets `data: { sessionId: socket.data?.sessionId }`
  so a timer firing after a successful rejoin is recognized as stale.
  Without it, the guard cannot see the session and would hard-leave —
  the exact race this change fixes.
- **Fail closed to existing behavior.** No `sessionId` or no
  `getPlayerBySessionId` → the current unconditional path runs, so
  lobby teardown and `destroy()`-driven eviction are unaffected.

## Tests

- Stale `room-leave` after session re-key: no `player-left`,
  `playerCount` unchanged, reconnected player still present.
- Grace timer firing after re-key: same assertions via a short/
  injected grace duration or by invoking the timer callback.
- Genuine missing player with no re-keyed record: hard-leave side
  effects still run (already covered; keep passing).
