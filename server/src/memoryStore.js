// Tiny KV facade. Default impl uses an in-process Map; swap with Redis/Valkey
// later by re-implementing the same async-friendly surface (get/set/del/keys/all).
// Calls are written as if they could be async so the consumer never changes.

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

// Singleton instances per logical "table". A real Redis swap would namespace these
// with a key prefix (e.g. `players:${id}`) on a single connection.
export const playerStore = new MemoryStore();
export const gridStore = new MemoryStore();
