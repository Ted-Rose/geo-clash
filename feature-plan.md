# Feature Plan: Clash — Reconnection Support

## Problem
When a player loses network during a Clash match:
- Server immediately removes the player (`disconnect` → `registry.leave()` → `game.removePlayer()`).
- Socket.io auto-reconnects with a new `socket.id`, but the client never re-emits `room-join`.
- `GameScreen` stays mounted but receives no events → clock and icons freeze.
- Other players see the disconnected player vanish instantly.

## Solution Overview
- **Client**: Generate a stable `sessionId` (per-tab, `sessionStorage`). On socket reconnect while inside a game, automatically re-emit `room-join` with saved `roomId` + `sessionId`. Show a "Reconnecting…" overlay instead of freezing.
- **Server**: On disconnect, *soft-disconnect* — mark player `connected: false`, start a grace-period timer, do NOT remove or decrement `playerCount`. On `room-join` with a known `sessionId`, *rejoin* — swap the old socket ID for the new one and send a fresh snapshot.

## Files Changed

### Client
- `client/src/socket.js`
- `client/src/App.jsx`
- `client/src/components/GameScreen.jsx`

### Server
- `server/src/clash/gameState.js`
- `server/src/roomRegistry.js`
- `server/src/socketHandlers.js`

---

## Implementation Steps

### Step 1 — `client/src/socket.js`: add `getSessionId()`
Generate a UUID once per tab and persist it in `sessionStorage`.

```js
export function getSessionId() {
  let id = sessionStorage.getItem('geo-clash-session');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('geo-clash-session', id);
  }
  return id;
}
```

---

### Step 2 — `server/src/clash/gameState.js`: session-aware player handling

a. `addPlayer(socketId, name, sessionId)` — store `sessionId` in the player record.

b. Add `getPlayerBySessionId(sessionId)` — scan `playerStore` for matching `sessionId`, return `{ player, socketId }` or `null`.

c. Add `swapSocketId(oldId, newId)` — re-key the player in `playerStore`:
   - `get(oldId)` → set `p.id = newId`, `p.connected = true`
   - `set(newId, p)` → `del(oldId)`
   - Also fix any `cell.progress.playerId === oldId` → `newId` in `gridStore`.

d. Add `connected` field to `addPlayer` (default `true`) and to `publicPlayer()`.

e. In `tick()`: skip capture-progress accumulation for players where `p.connected === false` (they shouldn't cap cells while offline), but still include them in `players-update` so others see a grayed-out icon.

---

### Step 3 — `server/src/roomRegistry.js`: soft-disconnect + rejoin

a. Add `this._disconnectTimers = new Map()` in constructor (keyed by `socketId`).
   No fixed constant — grace duration is computed dynamically (see below).

b. Add `async softDisconnect(roomId, socket)`:
   - Lock the room.
   - Get the player from `game.playerStore` by `socket.id`; if not found, fall through to `leave()`.
   - Set `player.connected = false`, save.
   - Broadcast `player-disconnected { id: socket.id }` to the room.
   - Socket leaves the Socket.io room; `socket.data.roomId = null`.
   - Compute grace duration: `game.remainingSeconds * 1000 + 30_000` (entire remaining match time plus 30 s buffer). If the match is not yet active or already ended, fall back to `30_000`.
   - Start a timeout of that duration that calls `registry.leave(roomId, fakeSocket)` (using a minimal object `{ id: socket.id, data: {} }`).
   - Store handle in `_disconnectTimers`.

c. Modify `join(roomId, socket, name, sessionId)`:
   - If `sessionId` is provided, call `game.getPlayerBySessionId(sessionId)`.
   - If found: cancel any pending `_disconnectTimers` for the old socket ID; call `game.swapSocketId(oldId, socket.id)`; re-join socket to room; register game handlers; emit `joined` + `snapshot`; broadcast `player-reconnected { id: socket.id, oldId }`; return early with `{ ok: true, reconnected: true, ... }`.
   - Otherwise: normal `addPlayer` path (existing code).

---

### Step 4 — `server/src/socketHandlers.js`: wire it up

a. Extract `name` and `sessionId` from `room-join` payload; pass `sessionId` to `registry.join()`.

b. Change `socket.on('disconnect', ...)` to call `registry.softDisconnect(roomId, socket)` instead of `registry.leave()`.

---

### Step 5 — `client/src/App.jsx`: auto-rejoin on reconnect

a. Import `getSessionId` from `./socket.js`.

b. Add a `rejoinRef` (`useRef(null)`) that stores `{ roomId, name, sessionId, room }` whenever the player successfully joins.

c. Modify `onJoined` callback: populate `rejoinRef.current`.

d. On `onLeave`: clear `rejoinRef.current = null`.

e. Add a `useEffect` that listens to `socket.on('connect')`:
   - If `rejoinRef.current` is set, emit `room-join` with the saved data.
   - On ack `{ ok: true, reconnected: true, snapshot }`: apply snapshot; keep `roomId` / `room` state as-is (no screen transition needed).
   - On ack `{ ok: false }`: call `onLeave()` — the game ended while they were gone.

f. **Do NOT clear `roomId` on disconnect** — the existing `onDisconnect` only sets `connected = false`, which is already the behavior. The `GameScreen` stays rendered during the outage.

g. Pass `connected` down to `GameScreen`.

---

### Step 6 — `client/src/components/GameScreen.jsx`: reconnecting overlay

a. Accept `connected` prop.

b. When `connected === false` and `!matchEnded`, render a semi-transparent overlay:
   ```jsx
   <div className="fixed inset-0 z-[700] bg-slate-900/60 backdrop-blur-sm
                   flex items-center justify-center">
     <div className="bg-slate-800 rounded-2xl px-6 py-4 text-white text-center shadow-2xl">
       <div className="text-lg font-semibold mb-1">Reconnecting…</div>
       <div className="text-sm text-slate-400">Your game is saved</div>
     </div>
   </div>
   ```

c. On `joined` event, update `myId` to the new `socket.id` (already handled by existing `onJoined` handler — verify it runs on rejoin).

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Grace timer expires before rejoin | `leave()` fires normally; server removes player. Client auto-rejoin ack returns `{ ok: false, reason: 'no-such-room' \| 'ended' }` → client calls `onLeave()`. |
| Player rejoins after match ends | `meta.status === 'ended'` → join returns `{ ok: false, reason: 'ended' }` → client shows lobby. |
| Two tabs with same `sessionId` | Second tab's `room-join` will swap the socket — the first tab loses its session. Acceptable for MVP. |
| Room destroyed (all players gone) | `softDisconnect` does not decrement `playerCount`, so the empty-room destroy timer is only triggered when the grace timer fires `leave()`. Existing `EMPTY_ROOM_TTL_MS` keeps the room alive 30 s after that. |

## Out of Scope
- Snake game (user confirmed clash only)
- Persistent reconnect across page refreshes (requires server-side session store — MVP uses in-memory)
