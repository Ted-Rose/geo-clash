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

// Sorted-set wrapper. Score is numeric; member is a string. Used as the
// persistent leaderboard backend so business code never touches ioredis
// directly.
export class ValkeyZSetStore {
  constructor(key, client) {
    this._key = key;
    this._client = client;
  }
  async add(member, score) {
    await this._client.zadd(this._key, score, member);
  }
  async addMany(pairs) {
    if (!pairs.length) return;
    const args = [];
    for (const { member, score } of pairs) args.push(score, member);
    await this._client.zadd(this._key, ...args);
  }
  async topRev(limit) {
    const raw = await this._client.zrevrange(this._key, 0, limit - 1, 'WITHSCORES');
    const out = [];
    for (let i = 0; i < raw.length; i += 2) {
      out.push({ member: raw[i], score: Number(raw[i + 1]) });
    }
    return out;
  }
  async members() {
    return this._client.zrange(this._key, 0, -1);
  }
  async size() {
    return this._client.zcard(this._key);
  }
  // Cap the set to `cap` highest-scoring entries by trimming the bottom.
  async trimToCap(cap) {
    return this._client.zremrangebyrank(this._key, 0, -1 - cap);
  }
  async clear() {
    await this._client.del(this._key);
  }
}
