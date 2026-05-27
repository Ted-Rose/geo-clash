import Redis from 'ioredis';

// Drop-in replacement for MemoryStore backed by Aiven Valkey.
// Values are JSON-serialised since Valkey stores strings.
export class ValkeyStore {
  constructor(prefix, client) {
    this._prefix = prefix;
    this._client = client;
  }

  _k(key) { return `${this._prefix}:${key}`; }

  async get(key) {
    const raw = await this._client.get(this._k(key));
    return raw === null ? undefined : JSON.parse(raw);
  }

  async set(key, value) {
    await this._client.set(this._k(key), JSON.stringify(value));
    return value;
  }

  async del(key) {
    return (await this._client.del(this._k(key))) > 0;
  }

  async has(key) {
    return (await this._client.exists(this._k(key))) > 0;
  }

  async keys() {
    const pattern = `${this._prefix}:*`;
    const raw = await this._client.keys(pattern);
    return raw.map(k => k.slice(this._prefix.length + 1));
  }

  async all() {
    const ks = await this.keys();
    const entries = await Promise.all(
      ks.map(async k => [k, await this.get(k)])
    );
    return entries;
  }

  async clear() {
    const ks = await this.keys();
    if (ks.length) {
      await this._client.del(ks.map(k => this._k(k)));
    }
  }

  size() {
    // sync size not meaningful for a remote store; safe no-op
    return 0;
  }
}
