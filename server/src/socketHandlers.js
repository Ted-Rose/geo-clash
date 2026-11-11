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

// `room-create` is unauthenticated, so cap rooms per connection: a legit
// host creates one room, maybe a couple across a session — 5 is far past
// real use but still blocks a single socket flooding the lobby. A fresh
// connection resets the counter; determined abuse is better stopped by
// the per-IP REST limiter and is out of scope for this MVP guard.
const MAX_ROOMS_PER_SOCKET = 5;

export function registerSocketHandlers(io, registry) {
  io.on('connection', async (socket) => {
    socket.data.roomId = null;
    socket.data.roomsCreated = 0;

    // Initial handshake: send the current room list so the lobby can render.
    socket.emit('rooms-updated', { rooms: await registry.list() });

    // ---- lobby events ---------------------------------------------------
    socket.on('rooms-list', async (ack) => {
      const rooms = await registry.list();
      if (typeof ack === 'function') ack({ rooms });
    });

    socket.on('room-create', async (payload, ack) => {
      if (socket.data.roomsCreated >= MAX_ROOMS_PER_SOCKET) {
        if (typeof ack === 'function') {
          ack({ ok: false, reason: 'room-create-limit' });
        }
        return;
      }
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
          timeLimitMs: payload?.timeLimitMs ?? 0,
          maxAmmo: payload?.maxAmmo ?? null,
          ammoRenewalMs: payload?.ammoRenewalMs ?? 5000,
        });
        socket.data.roomsCreated += 1;
        if (typeof ack === 'function') ack({ ok: true, room });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, reason: err.message });
      }
    });

    socket.on('room-join', async (payload, ack) => {
      const { roomId, name, lat, lng, sessionId } = payload || {};
      if (!roomId) {
        if (typeof ack === 'function') {
          ack({ ok: false, reason: 'no-room-id' });
        }
        return;
      }
      const result = await registry.join(roomId, socket, name, sessionId);
      if (result.ok && !result.reconnected) {
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
      if (roomId) await registry.softDisconnect(roomId, socket);
    });
  });
}
