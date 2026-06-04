// Snake-specific gameplay event handlers.
// Registered by the top-level socketHandlers.js when socket.data.gameType === 'snake'.

export function registerSnakeHandlers(socket, game) {
  // Client sends its authoritative position + snake state every tick.
  // tailPoints and score are client-owned; we store and relay them as-is.
  socket.on('location-update', async ({ lat, lng, heading, tailPoints, score } = {}) => {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    await game.updateLocation(socket.id, lat, lng, heading, tailPoints, score);
  });

  // Client locally detected that it ate a food item.
  // Server removes it from the authoritative list and awards the point.
  socket.on('eat_food', async ({ foodId } = {}) => {
    if (typeof foodId !== 'string') return;
    await game.eatFood(socket.id, foodId);
  });

  // Client ACKs a clash_verify from the server, proving it is still connected.
  // Both participants in a clash must ACK before the server commits the kill.
  socket.on('clash_ack', async ({ clashId } = {}) => {
    if (typeof clashId !== 'string') return;
    await game.clashAck(socket.id, clashId);
  });
}
