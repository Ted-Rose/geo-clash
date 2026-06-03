// Wires each Socket.io connection to the RoomRegistry. Thin top-level:
// lobby + connection lifecycle. Gameplay events are dispatched to per-game
// handlers based on the room's gameType.

import { registerClashHandlers } from './clash/socketHandlers.js';
import { registerSnakeHandlers } from './snake/socketHandlers.js';
import { registerTimeSync } from './shared/timeSync.js';

const GAME_HANDLERS = {
  clash: registerClashHandlers,
  snake: registerSnakeHandlers,
};

export function registerSocketHandlers(io, registry) {
  io.on('connection', async (socket) => {
    socket.data.roomId = null;

    // Initial handshake: send the current room list so the lobby can render.
    socket.emit('rooms-updated', { rooms: await registry.list() });

    // ---- lobby events ---------------------------------------------------
    socket.on('rooms-list', async (ack) => {
      const rooms = await registry.list();
      if (typeof ack === 'function') ack({ rooms });
    });

    socket.on('room-create', async (payload, ack) => {
      try {
        const room = await registry.create({
          name: payload?.name,
          hostId: socket.id,
          centerLat: payload?.centerLat,
          centerLng: payload?.centerLng,
          maxPlayers: payload?.maxPlayers,
          cellSize: payload?.cellSize,
          squaresPerSide: payload?.squaresPerSide,
          gameType: payload?.gameType || 'clash',
          arenaSideMeters: payload?.arenaSideMeters,
          foodCountTarget: payload?.foodCountTarget,
          foodRespawnIntervalMs: payload?.foodRespawnIntervalMs,
        });
        if (typeof ack === 'function') ack({ ok: true, room });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, reason: err.message });
      }
    });

    socket.on('room-join', async (payload, ack) => {
      const { roomId, name, lat, lng } = payload || {};
      if (!roomId) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'no-room-id' });
        return;
      }
      const result = await registry.join(roomId, socket, name);
      if (result.ok) {
        const game = registry.get(roomId);
        const meta = result.room;
        if (game && typeof lat === 'number' && typeof lng === 'number') {
          if (typeof game.ensureGridFromPlayer === 'function') {
            await game.ensureGridFromPlayer(lat, lng);
          }
          await game.updateLocation(socket.id, lat, lng, 0);
          result.snapshot = await game.snapshot();
        }
        socket.data.gameType = meta?.gameType || 'clash';
        const registerGameHandlers = GAME_HANDLERS[socket.data.gameType];
        if (registerGameHandlers) registerGameHandlers(socket, game);
        socket.emit('joined', { id: socket.id, roomId });
        socket.emit('snapshot', result.snapshot);
        io.to(roomId).emit('player-joined', { id: socket.id });
      }
      if (typeof ack === 'function') ack(result);
    });

    socket.on('room-leave', async () => {
      const roomId = socket.data.roomId;
      if (roomId) await registry.leave(roomId, socket);
    });

    // Clock skew measurement.
    registerTimeSync(socket);

    socket.on('disconnect', async () => {
      const roomId = socket.data.roomId;
      if (roomId) await registry.leave(roomId, socket);
    });
  });
}
