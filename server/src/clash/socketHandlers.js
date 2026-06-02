// Clash-specific gameplay event handlers.
// Called from the top-level socketHandlers.js when socket.data.gameType === 'clash'.

export function registerClashHandlers(socket, game) {
  socket.on('location-update', async ({ lat, lng, heading } = {}) => {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    await game.updateLocation(socket.id, lat, lng, heading);
  });

  socket.on('player-attack', async ({ heading, target } = {}) => {
    await game.attack(socket.id, { heading, target });
  });

  socket.on('player-shield', async () => {
    await game.activateShield(socket.id);
  });

  socket.on('player-respawn', async () => {
    await game.respawn(socket.id);
  });
}
