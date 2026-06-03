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

  // Client A detected it crashed into Client B (A is the victim).
  // Server relays a clash_verify event to B for dual-client confirmation.
  socket.on('clash_detected', ({ targetId } = {}) => {
    if (typeof targetId !== 'string') return;
    game.clashDetected(socket.id, targetId);
  });

  // Client B (the target) confirms or denies the clash reported by Client A.
  // Only a confirmed response triggers a score reset on the victim.
  socket.on('clash_confirmed', async ({ victimId, confirmed } = {}) => {
    if (typeof victimId !== 'string' || confirmed !== true) return;
    await game.clashConfirmed(socket.id, victimId);
  });
}
