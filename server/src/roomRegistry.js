// Owns concurrent GameState instances keyed by roomId. Mints unique ids,
// guards create/join/destroy with a lock, persists meta in a global store
// that mirrors the schema in feature-plan.md §2.1.

import { ulid } from 'ulid';
import { GameState } from './clash/gameState.js';
import { SnakeGameState } from './snake/gameState.js';
import {
  MemoryStore,
  makeRoomStores,
  redisClient,
} from './shared/memoryStore.js';
import { ValkeyStore } from './shared/valkeyStore.js';
import { RoomLock } from './shared/roomLock.js';
import { registerClashHandlers } from './clash/socketHandlers.js';
import { registerSnakeHandlers } from './snake/socketHandlers.js';

// Handler map — mirrors GAME_HANDLERS in socketHandlers.js for reconnect path.
const GAME_HANDLERS = {
  clash: registerClashHandlers,
  snake: registerSnakeHandlers,
};

// Factory map — extend here when adding new game types.
const GAME_FACTORIES = {
  clash: (opts) => new GameState(opts),
  snake: (opts) => new SnakeGameState(opts),
};

const META_PREFIX = 'rooms:meta';
const INDEX_KEY = 'rooms:index';
const EMPTY_ROOM_TTL_MS = 30_000; // grace period for mobile reconnects

// Tiny SET facade so business code never touches ioredis directly. Mirrors
// the MemoryStore async-friendly contract for in-process fallback.
class RoomIndex {
  constructor(redis) {
    this._redis = redis;
    this._local = new Set();
  }
  async add(id) {
    if (this._redis) await this._redis.sadd(INDEX_KEY, id);
    else this._local.add(id);
  }
  async remove(id) {
    if (this._redis) await this._redis.srem(INDEX_KEY, id);
    else this._local.delete(id);
  }
  async members() {
    if (this._redis) return this._redis.smembers(INDEX_KEY);
    return [...this._local];
  }
  async clear() {
    if (this._redis) await this._redis.del(INDEX_KEY);
    else this._local.clear();
  }
}

export class RoomRegistry {
  constructor(io, { now = () => Date.now() } = {}) {
    this._io = io;
    this._now = now;
    this._rooms = new Map(); // roomId -> GameState
    this._destroyTimers = new Map(); // roomId -> setTimeout handle
    this._disconnectTimers = new Map(); // socketId -> setTimeout handle
    this._lock = new RoomLock(redisClient);
    this._metaStore = redisClient
      ? new ValkeyStore(META_PREFIX, redisClient)
      : new MemoryStore();
    this._index = new RoomIndex(redisClient);
  }

  // ---- public API --------------------------------------------------------

  // Purge any room meta/index left in Valkey from a previous server process.
  // Must be called once on startup before accepting connections.
  async init() {
    const ids = await this._index.members();
    for (const id of ids) {
      await this._metaStore.del(id);
    }
    await this._index.clear();
  }

  async list() {
    const ids = await this._index.members();
    const out = [];
    for (const id of ids) {
      const meta = await this._metaStore.get(id);
      if (meta) out.push(meta);
    }
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return out;
  }

  get(roomId) {
    return this._rooms.get(roomId) || null;
  }

  async create({ name, hostId, centerLat, centerLng, maxPlayers = 8, cellSize = 10, squaresPerSide = 10, gameType = 'clash', arenaSideMeters, foodCountTarget, foodRespawnIntervalMs, maxAmmo = null, ammoRenewalMs = 5000 }) {
    return this._lock.withLock('create', async () => {
      const factory = GAME_FACTORIES[gameType];
      if (!factory) throw new Error(`unsupported-game-type:${gameType}`);
      const id = ulid();
      const meta = {
        id,
        name: name || `Room-${id.slice(-4)}`,
        hostId: hostId || null,
        status: 'lobby',
        createdAt: this._now(),
        playerCount: 0,
        maxPlayers,
        gameType,
        centerLat: typeof centerLat === 'number' ? centerLat : null,
        centerLng: typeof centerLng === 'number' ? centerLng : null,
        ...(gameType === 'snake' && {
          foodCountTarget: foodCountTarget ?? 10,
          foodRespawnIntervalMs: foodRespawnIntervalMs ?? 2000,
          arenaSideMeters: arenaSideMeters ?? 1000,
        }),
        ...(gameType === 'clash' && maxAmmo !== null && {
          maxAmmo,
          ammoRenewalMs,
        }),
      };
      const stores = makeRoomStores(id);
      const game = factory({
        io: this._io,
        roomId: id,
        roomName: meta.name,
        stores,
        onEnd: () => { this.destroy(id).catch(() => {}); },
        cellSize,
        squaresPerSide,
        maxAmmo,
        ammoRenewalMs,
        arenaSideMeters,
        centerLat,
        centerLng,
        foodCountTarget,
        foodRespawnIntervalMs,
      });
      if (typeof centerLat === 'number' && typeof centerLng === 'number') {
        if (typeof game.initGrid === 'function') {
          await game.initGrid(centerLat, centerLng);
        }
      }
      this._rooms.set(id, game);
      await this._metaStore.set(id, meta);
      await this._index.add(id);
      this._broadcastList();
      return meta;
    });
  }

  async join(roomId, socket, name, sessionId) {
    return this._lock.withLock(roomId, async () => {
      const game = this._rooms.get(roomId);
      if (!game) return { ok: false, reason: 'no-such-room' };
      const meta = await this._metaStore.get(roomId);
      if (!meta) return { ok: false, reason: 'no-such-room' };
      if (meta.status === 'ended') return { ok: false, reason: 'ended' };

      // Reconnect path: find an existing player by sessionId.
      if (sessionId && typeof game.getPlayerBySessionId === 'function') {
        const existing = await game.getPlayerBySessionId(sessionId);
        if (existing) {
          const { socketId: oldId } = existing;
          const pendingDc = this._disconnectTimers.get(oldId);
          if (pendingDc) {
            clearTimeout(pendingDc);
            this._disconnectTimers.delete(oldId);
          }
          await game.swapSocketId(oldId, socket.id);
          await socket.join(roomId);
          socket.data.roomId = roomId;
          socket.data.gameType = meta.gameType || 'clash';
          const registerGameHandlers =
            GAME_HANDLERS[socket.data.gameType];
          if (registerGameHandlers) registerGameHandlers(socket, game);
          const snapshot = await game.snapshot();
          socket.emit('joined', { id: socket.id, roomId });
          socket.emit('snapshot', snapshot);
          this._io.to(roomId)
            .emit('player-reconnected', { id: socket.id, oldId });
          return {
            ok: true,
            reconnected: true,
            room: meta,
            snapshot,
          };
        }
      }

      if (meta.playerCount >= meta.maxPlayers) {
        return { ok: false, reason: 'room-full' };
      }
      const pending = this._destroyTimers.get(roomId);
      if (pending) {
        clearTimeout(pending);
        this._destroyTimers.delete(roomId);
      }
      await game.addPlayer(socket.id, name, sessionId);
      socket.join(roomId);
      socket.data.roomId = roomId;
      meta.playerCount += 1;
      await this._metaStore.set(roomId, meta);
      if (!game.matchActive && game.status === 'lobby') game.startMatch();
      this._broadcastList();
      return { ok: true, room: meta, snapshot: await game.snapshot() };
    });
  }

  async softDisconnect(roomId, socket) {
    return this._lock.withLock(roomId, async () => {
      const game = this._rooms.get(roomId);
      if (!game) return;
      const p = await game.playerStore.get(socket.id);
      if (!p) {
        // Player not found — fall back to a hard leave.
        await game.removePlayer(socket.id);
        socket.leave(roomId);
        socket.data.roomId = null;
        this._io.to(roomId).emit('player-left', { id: socket.id });
        const meta = await this._metaStore.get(roomId);
        if (meta) {
          meta.playerCount = Math.max(0, (meta.playerCount || 1) - 1);
          await this._metaStore.set(roomId, meta);
          if (meta.playerCount === 0) await this.destroy(roomId);
        }
        this._broadcastList();
        return;
      }
      p.connected = false;
      await game.playerStore.set(socket.id, p);
      socket.leave(roomId);
      socket.data.roomId = null;
      this._io.to(roomId).emit('player-disconnected', { id: socket.id });

      const graceDurationMs =
        game.matchActive && typeof game.remainingSeconds === 'number'
          ? game.remainingSeconds * 1000 + 30_000
          : 30_000;

      const fakeSocket = { id: socket.id, data: {}, leave: () => {}, join: () => {} };
      const handle = setTimeout(async () => {
        this._disconnectTimers.delete(socket.id);
        await this.leave(roomId, fakeSocket);
      }, graceDurationMs);
      if (typeof handle.unref === 'function') handle.unref();
      this._disconnectTimers.set(socket.id, handle);
    });
  }

  async leave(roomId, socket) {
    return this._lock.withLock(roomId, async () => {
      const game = this._rooms.get(roomId);
      if (!game) return;
      await game.removePlayer(socket.id);
      socket.leave(roomId);
      socket.data.roomId = null;
      this._io.to(roomId).emit('player-left', { id: socket.id });
      let shouldDestroy = false;
      const meta = await this._metaStore.get(roomId);
      if (meta) {
        meta.playerCount = Math.max(0, (meta.playerCount || 1) - 1);
        await this._metaStore.set(roomId, meta);
        shouldDestroy = meta.playerCount === 0;
      }
      this._broadcastList();
      if (shouldDestroy) {
        await this.destroy(roomId);
      }
    });
  }

  async destroy(roomId) {
    const pending = this._destroyTimers.get(roomId);
    if (pending) {
      clearTimeout(pending);
      this._destroyTimers.delete(roomId);
    }
    const game = this._rooms.get(roomId);
    // Re-entrancy guard: endMatch fires onEnd → destroy. The first call ends
    // the match (which already archives + purges runtime state); subsequent
    // calls just clean up the registry-owned entries.
    if (game && game.status !== 'ended') {
      try { await game.endMatch(); } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[roomRegistry] endMatch error:', err.message);
      }
    }
    this._rooms.delete(roomId);
    // Evict any sockets still attached to the room.
    try {
      const sockets = await this._io.in(roomId).fetchSockets();
      for (const s of sockets) {
        s.leave(roomId);
        if (s.data) s.data.roomId = null;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[roomRegistry] socket evict error:', err.message);
    }
    await this._metaStore.del(roomId);
    await this._index.remove(roomId);
    this._broadcastList();
  }

  async _broadcastList() {
    try {
      const rooms = await this.list();
      this._io.emit('rooms-updated', { rooms });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[roomRegistry] broadcast list error:', err.message);
    }
  }
}
