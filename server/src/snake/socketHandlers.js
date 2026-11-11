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
    // relay them as-is. `payload || {}` — an explicit null payload
    // must not throw.
    ['location-update', async (payload) => {
      const { lat, lng, heading, tailPoints, score } = payload || {};
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      await game.updateLocation(
        socket.id, lat, lng, heading, tailPoints, score
      );
    }],

    // Client locally detected that it ate a food item. The server
    // validates the id (live or recently claimed), removes it from
    // the authoritative list, and awards the point.
    ['eat_food', async (payload) => {
      const { foodId } = payload || {};
      if (typeof foodId !== 'string') return;
      await game.eatFood(socket.id, foodId);
    }],

    // Client ACKs a clash_verify from the server. Only the deciding
    // participant's ACK commits the kill — the victim's is advisory.
    ['clash_ack', async (payload) => {
      const { clashId } = payload || {};
      if (typeof clashId !== 'string') return;
      await game.clashAck(socket.id, clashId);
    }],
  ]);
}
