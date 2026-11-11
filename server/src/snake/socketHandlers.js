// Snake-specific gameplay event handlers.
// Registered by the top-level socketHandlers.js when
// socket.data.gameType === 'snake'.

import { bindGameHandlers } from '../shared/gameHandlers.js';

export function registerSnakeHandlers(socket, game) {
  // Bound per (socket, game): a same-game rejoin no-ops, while a
  // recovered socket or a different room re-binds its listeners.
  bindGameHandlers(socket, game, [
    // Client sends its authoritative position + snake state every
    // tick. tailPoints and score are client-owned; we store and
    // relay them as-is.
    ['location-update', async ({
      lat, lng, heading, tailPoints, score,
    } = {}) => {
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      await game.updateLocation(
        socket.id, lat, lng, heading, tailPoints, score
      );
    }],

    // Client locally detected that it ate a food item. The server
    // removes it from the authoritative list and awards the point.
    ['eat_food', async ({ foodId } = {}) => {
      if (typeof foodId !== 'string') return;
      await game.eatFood(socket.id, foodId);
    }],

    // Client ACKs a clash_verify from the server, proving it is still
    // connected. Both participants in a clash must ACK before the
    // server commits the kill.
    ['clash_ack', async ({ clashId } = {}) => {
      if (typeof clashId !== 'string') return;
      await game.clashAck(socket.id, clashId);
    }],
  ]);
}
