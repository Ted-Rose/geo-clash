// Clash-specific gameplay event handlers.
// Called from the top-level socketHandlers.js when
// socket.data.gameType === 'clash'.

import { bindGameHandlers } from '../shared/gameHandlers.js';

export function registerClashHandlers(socket, game) {
  // Bound per (socket, game): a same-game rejoin no-ops, while a
  // recovered socket or a different room re-binds its listeners.
  bindGameHandlers(socket, game, [
    ['location-update', async ({ lat, lng, heading } = {}) => {
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      await game.updateLocation(socket.id, lat, lng, heading);
    }],

    ['player-attack', async ({ heading, target } = {}) => {
      await game.attack(socket.id, { heading, target });
    }],

    ['player-shield', async () => {
      await game.activateShield(socket.id);
    }],

    ['player-respawn', async () => {
      await game.respawn(socket.id);
    }],
  ]);
}
