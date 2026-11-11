// Snake-specific gameplay event handlers.
// Registered by the top-level socketHandlers.js when
// socket.data.gameType === 'snake'.

export function registerSnakeHandlers(socket, game) {
  // Client sends its authoritative position + snake state every tick.
  // tailPoints and score are client-owned; we store and relay them as-is.
  socket.on('location-update', async (payload) => {
    // `payload || {}` — an explicit null payload must not throw.
    const { lat, lng, heading, tailPoints, score } = payload || {};
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    await game.updateLocation(
      socket.id, lat, lng, heading, tailPoints, score,
    );
  });

  // Client locally detected that it ate a food item.
  // Server removes it from the authoritative list and awards the point.
  socket.on('eat_food', async (payload) => {
    const { foodId } = payload || {};
    if (typeof foodId !== 'string') return;
    await game.eatFood(socket.id, foodId);
  });

  // Client ACKs a clash_verify from the server. Only the deciding
  // participant's ACK commits the kill — the victim's is advisory.
  socket.on('clash_ack', async (payload) => {
    const { clashId } = payload || {};
    if (typeof clashId !== 'string') return;
    await game.clashAck(socket.id, clashId);
  });
}
