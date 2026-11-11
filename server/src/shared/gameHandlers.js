// Gameplay-listener bookkeeping for a socket.
//
// socket.data survives socket.io connectionStateRecovery, but the
// Socket instance — and every listener on it — does not. The
// once-per-join guard therefore lives on the non-persisted
// `socket._handlersFor`, keyed to the GameState instance the
// listeners close over: a rejoin to the same game is a no-op, while
// a recovered socket or a different room re-binds cleanly.

// Remove any listeners registered by bindGameHandlers. Safe on bare
// socket stubs (disconnect-timer fakes, RemoteSocket evictions).
// Note: under a future multi-node adapter, RemoteSockets carry no
// _gameListeners and lack .off — rebind-on-join is the fallback there.
export function unbindGameHandlers(socket) {
  const bound = socket._gameListeners;
  if (Array.isArray(bound) && typeof socket.off === 'function') {
    for (const [ev, cb] of bound) socket.off(ev, cb);
  }
  socket._gameListeners = null;
  socket._handlersFor = null;
}

// Attach `listeners` ([event, cb] pairs) to socket, first detaching
// any bound to a previous game. No-ops while bound to `game` so a
// same-game rejoin never stacks duplicate listeners.
export function bindGameHandlers(socket, game, listeners) {
  if (socket._handlersFor === game) return;
  unbindGameHandlers(socket);
  socket._gameListeners = [];
  for (const [ev, cb] of listeners) {
    socket.on(ev, cb);
    socket._gameListeners.push([ev, cb]);
  }
  socket._handlersFor = game;
}
