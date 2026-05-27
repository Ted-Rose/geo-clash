// Tiny KV facade. Default impl uses an in-process Map; swap with Redis/Valkey
// later by re-implementing the same async-friendly surface (get/set/del/keys/all).
// Calls are written as if they could be async so the consumer never changes.

import { ValkeyStore } from './valkeyStore.js';
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

function makeStores() {
  if (process.env.VALKEY_URL) {
    const client = new Redis(process.env.VALKEY_URL, {
      tls: {},            // Aiven requires TLS; ioredis honours rediss:// too
      lazyConnect: false,
    });
    client.on('error', err => console.error('[valkey]', err.message));
    return {
      playerStore: new ValkeyStore('players', client),
      gridStore:   new ValkeyStore('grid', client),
    };
  }
  // Local dev: in-process Maps (no VALKEY_URL set)
  return {
    playerStore: new MemoryStore(),
    gridStore:   new MemoryStore(),
  };
}

export const { playerStore, gridStore } = makeStores();
