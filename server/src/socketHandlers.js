// Wires each Socket.io connection to the RoomRegistry. Handlers are thin:
// validate input, look up the player's GameState by socket.data.roomId, and
// delegate. Gameplay events refuse to act when the socket is not in a room.

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
        // Seed the grid from the joining player's location if it didn't
        // exist yet (mirrors legacy single-room behaviour).
        const game = registry.get(roomId);
        if (game && typeof lat === 'number' && typeof lng === 'number') {
          await game.ensureGridFromPlayer(lat, lng);
          await game.updateLocation(socket.id, lat, lng, 0);
          // Re-snapshot now that the grid exists.
          result.snapshot = await game.snapshot();
        }
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

    // Clock skew measurement. Client emits with its local send timestamp;
    // server replies with both, so the client can compute the skew without
    // a second round-trip.
    socket.on('time-sync', (clientSendMs, ack) => {
      const serverNowMs = Date.now();
      if (typeof ack === 'function') {
        ack({ clientSendMs, serverNowMs });
      } else {
        socket.emit('time-sync', { clientSendMs, serverNowMs });
      }
    });

    // ---- gameplay events (room-scoped) ---------------------------------
    function gameOrNull() {
      const id = socket.data.roomId;
      if (!id) return null;
      return registry.get(id);
    }

    socket.on('location-update', async ({ lat, lng, heading } = {}) => {
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      const game = gameOrNull();
      if (!game) return;
      await game.updateLocation(socket.id, lat, lng, heading);
    });

    socket.on('player-attack', async ({ heading, target } = {}) => {
      const game = gameOrNull();
      if (!game) return;
      await game.attack(socket.id, { heading, target });
    });

    socket.on('player-shield', async () => {
      const game = gameOrNull();
      if (!game) return;
      await game.activateShield(socket.id);
    });

    socket.on('player-respawn', async () => {
      const game = gameOrNull();
      if (!game) return;
      await game.respawn(socket.id);
    });

    socket.on('disconnect', async () => {
      const roomId = socket.data.roomId;
      if (roomId) await registry.leave(roomId, socket);
    });
  });
}
