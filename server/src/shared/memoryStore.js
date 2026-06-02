// Tiny KV facade. Default impl uses an in-process Map; swap with Redis/Valkey
// later by re-implementing the same async-friendly surface (get/set/del/keys/all).
// Calls are written as if they could be async so the consumer never changes.
//
// Per-room collections are minted via `makeRoomStores(roomId)` so every
// runtime key for a room matches the pattern `room:<roomId>:*` and a single
// `clear()` (or `SCAN+DEL`) drains it.

import { ValkeyStore, ValkeyZSetStore } from './valkeyStore.js';
import Redis from 'ioredis';

export class MemoryStore {
  constructor() {
    this._map = new Map();
  }

  async get(key) {
    return this._map.get(key);
  }

  async set(key, value) {
    this._map.set(key, value);
    return value;
  }

  async del(key) {
    return this._map.delete(key);
  }

  async has(key) {
    return this._map.has(key);
  }

  async keys() {
    return [...this._map.keys()];
  }

  async all() {
    return [...this._map.entries()];
  }

  async clear() {
    this._map.clear();
  }

  size() {
    return this._map.size;
  }
}

// In-memory leaderboard fallback. Maintains a sorted array; cap at 10k.
// `archive` accepts `{ score, metric, gameType, ... }`.  For backward compat,
// `squaresCaptured` is also accepted as an alias for `score`.
export class MemoryLeaderboardStore {
  constructor({ cap = 10_000 } = {}) {
    this._cap = cap;
    this._entries = [];      // [{ member, score, meta }]
    this._index = new Map(); // member -> idx
  }
  async archive({
    playerId, matchId, name, color,
    score, squaresCaptured,
    metric = 'squares', gameType = 'clash',
    finishedAt, roomName,
  }) {
    const resolvedScore = score ?? squaresCaptured ?? 0;
    const member = `${playerId}:${matchId}`;
    const meta = {
      name, color, score: resolvedScore, metric, gameType, finishedAt, roomName,
    };
    const existing = this._index.get(member);
    if (existing != null) {
      this._entries[existing] = { member, score: resolvedScore, meta };
    } else {
      this._entries.push({ member, score: resolvedScore, meta });
    }
    this._entries.sort((a, b) => b.score - a.score);
    if (this._entries.length > this._cap) {
      this._entries = this._entries.slice(0, this._cap);
    }
    this._index.clear();
    this._entries.forEach((e, i) => this._index.set(e.member, i));
    return meta;
  }
  async top(limit = 25, { gameType } = {}) {
    let entries = this._entries;
    if (gameType) entries = entries.filter((e) => e.meta.gameType === gameType);
    return entries.slice(0, limit).map((e) => ({
      member: e.member,
      score: e.score,
      ...e.meta,
    }));
  }
  async clear() {
    this._entries = [];
    this._index.clear();
  }
}

// Redis-backed leaderboard. Stores a ZSET per gameType plus meta hashes.
export class ValkeyLeaderboardStore {
  constructor(client, { cap = 10_000 } = {}) {
    this._client = client;
    this._cap = cap;
    this._metaPrefix = 'leaderboard:meta';
  }
  _zsetKey(gameType = 'all') { return `leaderboard:${gameType}`; }
  _metaKey(member) { return `${this._metaPrefix}:${member}`; }
  async archive({
    playerId, matchId, name, color,
    score, squaresCaptured,
    metric = 'squares', gameType = 'clash',
    finishedAt, roomName,
  }) {
    const resolvedScore = score ?? squaresCaptured ?? 0;
    const member = `${playerId}:${matchId}`;
    const meta = {
      name, color, score: resolvedScore, metric, gameType, finishedAt, roomName,
    };
    const zset = new ValkeyZSetStore(this._zsetKey(gameType), this._client);
    const zsetAll = new ValkeyZSetStore(this._zsetKey('all'), this._client);
    await zset.add(member, resolvedScore);
    await zsetAll.add(member, resolvedScore);
    await this._client.set(this._metaKey(member), JSON.stringify(meta));
    await zset.trimToCap(this._cap);
    return meta;
  }
  async top(limit = 25, { gameType } = {}) {
    const zset = new ValkeyZSetStore(
      this._zsetKey(gameType || 'all'), this._client
    );
    const entries = await zset.topRev(limit);
    const out = [];
    for (const e of entries) {
      const metaRaw = await this._client.get(this._metaKey(e.member));
      const meta = metaRaw ? JSON.parse(metaRaw) : {};
      out.push({ member: e.member, score: e.score, ...meta });
    }
    return out;
  }
  async clear() {
    for (const gt of ['all', 'clash', 'snake']) {
      const zset = new ValkeyZSetStore(this._zsetKey(gt), this._client);
      const members = await zset.members();
      await zset.clear();
      if (members.length) {
        await this._client.del(...members.map((m) => this._metaKey(m)));
      }
    }
  }
}

// ---- bootstrap ---------------------------------------------------------

function makeRedisClient() {
  if (!process.env.VALKEY_URL) return null;
  const client = new Redis(process.env.VALKEY_URL, {
    tls: {},
    lazyConnect: false,
  });
  client.on('error', (err) => console.error('[valkey]', err.message));
  return client;
}

export const redisClient = makeRedisClient();

export function makeRoomStores(roomId) {
  if (redisClient) {
    return {
      playerStore:     new ValkeyStore(`room:${roomId}:players`, redisClient),
      gridStore:       new ValkeyStore(`room:${roomId}:grid`, redisClient),
      projectileStore: new ValkeyStore(`room:${roomId}:projectiles`, redisClient),
    };
  }
  return {
    playerStore:     new MemoryStore(),
    gridStore:       new MemoryStore(),
    projectileStore: new MemoryStore(),
  };
}

export const leaderboardStore = redisClient
  ? new ValkeyLeaderboardStore(redisClient)
  : new MemoryLeaderboardStore();
