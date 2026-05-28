// Owns concurrent GameState instances keyed by roomId. Mints unique ids,
// guards create/join/destroy with a lock, persists meta in a global store
// that mirrors the schema in feature-plan.md §2.1.

import { ulid } from 'ulid';
import { GameState } from './gameState.js';
import {
  MemoryStore,
  makeRoomStores,
  redisClient,
} from './memoryStore.js';
import { ValkeyStore } from './valkeyStore.js';
import { RoomLock } from './roomLock.js';

const META_PREFIX = 'rooms:meta';
const INDEX_KEY = 'rooms:index';

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
}

export class RoomRegistry {
  constructor(io, { now = () => Date.now() } = {}) {
    this._io = io;
    this._now = now;
    this._rooms = new Map(); // roomId -> GameState
    this._lock = new RoomLock(redisClient);
    this._metaStore = redisClient
      ? new ValkeyStore(META_PREFIX, redisClient)
      : new MemoryStore();
    this._index = new RoomIndex(redisClient);
  }

  // ---- public API --------------------------------------------------------

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

  async create({ name, hostId, centerLat, centerLng, maxPlayers = 8 }) {
    return this._lock.withLock('create', async () => {
      const id = ulid();
      const meta = {
        id,
        name: name || `Room-${id.slice(-4)}`,
        hostId: hostId || null,
        status: 'lobby',
        createdAt: this._now(),
        playerCount: 0,
        maxPlayers,
        centerLat: typeof centerLat === 'number' ? centerLat : null,
        centerLng: typeof centerLng === 'number' ? centerLng : null,
      };
      const stores = makeRoomStores(id);
      const game = new GameState({
        io: this._io,
        roomId: id,
        roomName: meta.name,
        stores,
        onEnd: () => { this.destroy(id).catch(() => {}); },
      });
      if (typeof centerLat === 'number' && typeof centerLng === 'number') {
        await game.initGrid(centerLat, centerLng);
      }
      this._rooms.set(id, game);
      await this._metaStore.set(id, meta);
      await this._index.add(id);
      this._broadcastList();
      return meta;
    });
  }

  async join(roomId, socket, name) {
    return this._lock.withLock(roomId, async () => {
      const game = this._rooms.get(roomId);
      if (!game) return { ok: false, reason: 'no-such-room' };
      const meta = await this._metaStore.get(roomId);
      if (!meta) return { ok: false, reason: 'no-such-room' };
      if (meta.status === 'ended') return { ok: false, reason: 'ended' };
      if (meta.playerCount >= meta.maxPlayers) {
        return { ok: false, reason: 'room-full' };
      }
      await game.addPlayer(socket.id, name);
      socket.join(roomId);
      socket.data.roomId = roomId;
      meta.playerCount += 1;
      await this._metaStore.set(roomId, meta);
      if (!game.matchActive && game.status === 'lobby') game.startMatch();
      this._broadcastList();
      return { ok: true, room: meta, snapshot: await game.snapshot() };
    });
  }

  async leave(roomId, socket) {
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
    // Empty rooms are tidied up to stop their tick + free the lobby slot.
    // The per-room lock taken by `join` blocks reuse during destroy.
    if (shouldDestroy) {
      await this._lock.withLock(roomId, async () => {
        const stillMeta = await this._metaStore.get(roomId);
        if (stillMeta && stillMeta.playerCount === 0) {
          await this.destroy(roomId);
        }
      });
    }
  }

  async destroy(roomId) {
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
