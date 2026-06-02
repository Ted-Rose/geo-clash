// Snake-specific gameplay event handlers.
// Registered by the top-level socketHandlers.js when socket.data.gameType === 'snake'.

export function registerSnakeHandlers(socket, game) {
  socket.on('location-update', async ({ lat, lng, heading } = {}) => {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    await game.updateLocation(socket.id, lat, lng, heading);
  });
}
