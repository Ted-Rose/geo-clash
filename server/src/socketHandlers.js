// Wires each Socket.io connection to the GameState. Handlers are thin:
// validate input shape, then delegate. Broadcasts happen inside GameState.

export function registerSocketHandlers(io, game) {
  io.on('connection', async (socket) => {
    // initial handshake — client gets full snapshot
    socket.emit('snapshot', await game.snapshot());

    socket.on('player-join', async ({ name, lat, lng } = {}) => {
      if (typeof lat === 'number' && typeof lng === 'number') {
        await game.ensureGridFromPlayer(lat, lng);
      }
      const player = await game.addPlayer(socket.id, name);
      socket.emit('joined', { id: socket.id, player });
      io.emit('player-joined', { player });
      if (!game.matchActive) game.startMatch();
      // re-broadcast snapshot so newcomer renders grid immediately
      socket.emit('snapshot', await game.snapshot());
    });

    socket.on('location-update', async ({ lat, lng, heading } = {}) => {
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      await game.updateLocation(socket.id, lat, lng, heading);
    });

    socket.on('player-attack', async ({ heading } = {}) => {
      await game.attack(socket.id, heading);
    });

    socket.on('player-shield', async () => {
      await game.activateShield(socket.id);
    });

    socket.on('player-respawn', async () => {
      await game.respawn(socket.id);
    });

    socket.on('disconnect', async () => {
      await game.removePlayer(socket.id);
      io.emit('player-left', { id: socket.id });
    });
  });
}
