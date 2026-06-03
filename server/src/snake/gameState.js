// Geo Snake game state + tick loop — hybrid client-authoritative model.
//
// CLIENT is the source of truth for its own snake (position, tail, score).
// SERVER is the source of truth for food locations.
//
// Flow:
//   location-update  → server stores client-supplied state, relays to peers
//   eat_food         → server removes food (tolerates duplicate claims),
//                      awards point to reporting player, broadcasts food-update
//   clash_detected   → server relays clash_verify to the target client
//   clash_confirmed  → server kills victim if both sides verified

import { makeRoomStores, leaderboardStore } from '../shared/memoryStore.js';
import { bboxAround } from '../shared/gridUtils.js';
import { replenishFood } from './food.js';
import {
  FOOD_RESPAWN_INTERVAL_MS,
  FOOD_SPAWN_RADIUS_M,
  TICK_MS,
  FOOD_COUNT_TARGET,
  FOOD_SCORE_PER_ITEM,
  COLORS,
} from './constants.js';

// How long (ms) a food-eaten record is kept to allow duplicate eat_food
// events from different clients without rejecting them.
const EAT_RACE_WINDOW_MS = 3000;

// How long (ms) a pending clash is kept before it expires unconfirmed.
const CLASH_PENDING_TTL_MS = 5000;

export class SnakeGameState {
  constructor({
    io,
    roomId,
    roomName,
    stores,
    onEnd,
    centerLat,
    centerLng,
    arenaSideMeters = 50,
    foodCountTarget = FOOD_COUNT_TARGET,
    foodRespawnIntervalMs = FOOD_RESPAWN_INTERVAL_MS,
  } = {}) {
    if (!io) throw new Error('SnakeGameState: io required');
    if (!roomId) throw new Error('SnakeGameState: roomId required');
    this.io = io;
    this.roomId = roomId;
    this.roomName = roomName || roomId;
    const s = stores || makeRoomStores(roomId);
    this.playerStore = s.playerStore;
    this._onEnd = onEnd || null;
    this.status = 'lobby';
    this.matchActive = false;
    this._foodCountTarget = foodCountTarget;
    this._foodRespawnIntervalMs = foodRespawnIntervalMs;
    this._tickHandle = null;
    this._foodInterval = null;
    this._lastTick = Date.now();
    this._colorIdx = 0;
    this._foods = [];
    this._bbox = null;
    this._foodSpawnCenter = null;
    this._centerLat = typeof centerLat === 'number' ? centerLat : null;
    this._centerLng = typeof centerLng === 'number' ? centerLng : null;
    this._arenaSideMeters = arenaSideMeters;
    // foodId → timestamp of when it was eaten (race-condition window)
    this._recentlyEaten = new Map();
    // reporterId → { targetId, timestamp } pending clash verifications
    this._pendingClashes = new Map();
    if (this._centerLat !== null && this._centerLng !== null) {
      this._initArena(this._centerLat, this._centerLng);
    }
  }

  _emit(event, payload) {
    this.io.to(this.roomId).emit(event, payload);
  }

  _initArena(lat, lng) {
    this._bbox = bboxAround(lat, lng, this._arenaSideMeters);
    this._foodSpawnCenter = { lat, lng };
    this._foods = replenishFood([], this._foodSpawnCenter, FOOD_SPAWN_RADIUS_M, this._foodCountTarget);
  }

  startMatch() {
    if (this.matchActive) return;
    if (this.status === 'ending' || this.status === 'ended') return;
    this.matchActive = true;
    this.status = 'active';
    this._lastTick = Date.now();
    if (!this._tickHandle) {
      this._tickHandle = setInterval(() => this._tick().catch(() => {}), TICK_MS);
    }
    if (!this._foodInterval) {
      this._foodInterval = setInterval(() => {
        if (!this.matchActive || !this._foodSpawnCenter) return;
        const before = this._foods.length;
        this._foods = replenishFood(this._foods, this._foodSpawnCenter, FOOD_SPAWN_RADIUS_M, this._foodCountTarget);
        if (this._foods.length !== before) {
          this._emit('food-update', { foods: this._foods });
        }
      }, this._foodRespawnIntervalMs);
    }
    this._emit('match-start', {
      bbox: this._bbox,
      foods: this._foods,
    });
  }

  async endMatch() {
    if (this.status === 'ending' || this.status === 'ended') return;
    this.status = 'ending';
    this.matchActive = false;
    if (this._tickHandle) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
    if (this._foodInterval) {
      clearInterval(this._foodInterval);
      this._foodInterval = null;
    }

    let archived = [];
    try {
      const players = (await this.playerStore.all()).map(([, p]) => p);
      const matchId = `${this.roomId}:${Date.now()}`;
      for (const p of players) {
        await leaderboardStore.archive({
          playerId: p.id,
          matchId,
          name: p.name,
          color: p.color,
          score: p.score,
          metric: 'kills',
          gameType: 'snake',
          finishedAt: Date.now(),
          roomName: this.roomName,
        });
        archived.push({ id: p.id, name: p.name, color: p.color, score: p.score });
      }
      archived.sort((a, b) => b.score - a.score);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[snake/gameState] archive error:', err.message);
    }

    try {
      await this.playerStore.clear?.();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[snake/gameState] purge error:', err.message);
    }

    this._emit('match-end', { scores: this._scores(await this._allPlayers()), leaderboard: archived });
    this.status = 'ended';
    this._onEnd?.();
  }

  // ---- players -----------------------------------------------------------

  async addPlayer(id, name) {
    const color = COLORS[this._colorIdx++ % COLORS.length];
    const spawn = this._spawnPoint();
    const player = {
      id,
      name: name || `P-${id.slice(0, 4)}`,
      color,
      lat: spawn.lat,
      lng: spawn.lng,
      heading: 0,
      alive: true,
      score: 0,
      kills: 0,
      tailPoints: [],
      spawnedAt: Date.now(),
      lastSeen: Date.now(),
    };
    await this.playerStore.set(id, player);
    return player;
  }

  async removePlayer(id) {
    await this.playerStore.del(id);
  }

  // Client is now the source of truth for its own snake state.
  // We accept tailPoints and score directly from the client, storing them
  // so they can be relayed to enemy clients on the next tick.
  async updateLocation(id, lat, lng, heading, tailPoints, score) {
    const p = await this.playerStore.get(id);
    if (!p) return;
    if (!this._bbox) this._initArena(lat, lng);
    p.lat = lat;
    p.lng = lng;
    if (typeof heading === 'number') p.heading = heading;
    p.lastSeen = Date.now();
    // Accept client-authoritative tail and score when provided
    if (Array.isArray(tailPoints)) p.tailPoints = tailPoints;
    if (typeof score === 'number') p.score = score;
    await this.playerStore.set(id, p);
  }

  // ---- food authority ----------------------------------------------------

  // Called when a client reports eating a food item.
  // Awards FOOD_SCORE_PER_ITEM to the player unconditionally — if a second
  // client reports the same food within EAT_RACE_WINDOW_MS we still award
  // points to tolerate network-lag race conditions. The food is removed from
  // the live list on the first claim.
  async eatFood(playerId, foodId) {
    if (!this.matchActive) return;
    const p = await this.playerStore.get(playerId);
    if (!p) return;

    const now = Date.now();

    // Purge stale recently-eaten entries
    for (const [fid, ts] of this._recentlyEaten) {
      if (now - ts > EAT_RACE_WINDOW_MS) this._recentlyEaten.delete(fid);
    }

    // Remove from live food list if still present (first claim)
    const foodIdx = this._foods.findIndex((f) => f.id === foodId);
    if (foodIdx !== -1) {
      this._foods.splice(foodIdx, 1);
      this._recentlyEaten.set(foodId, now);
      this._emit('food-update', { foods: this._foods });
    }
    // else: food already gone — check if it was eaten within the race window
    // and still grant the point if so (or if not tracked at all, still award).

    p.score = (p.score || 0) + FOOD_SCORE_PER_ITEM;
    await this.playerStore.set(playerId, p);
    this._emit('snake-ate', { playerId, foodId, score: p.score });
  }

  // ---- clash (player-vs-player) handshake --------------------------------

  // Client A reports it crashed into Client B.  A is the victim.
  // Server relays a clash_verify request to B's socket.
  clashDetected(reporterId, targetId) {
    if (!this.matchActive) return;
    const now = Date.now();

    // Purge expired pending clashes
    for (const [rid, entry] of this._pendingClashes) {
      if (now - entry.timestamp > CLASH_PENDING_TTL_MS) {
        this._pendingClashes.delete(rid);
      }
    }

    this._pendingClashes.set(reporterId, { targetId, timestamp: now });

    // Ask the target client to verify the clash from its own perspective.
    this.io.to(targetId).emit('clash_verify', { victimId: reporterId });
  }

  // Client B confirms (or both clients independently report).
  // victimId is the player whose score should be reset.
  // killerId is the surviving player who gets kill credit.
  async clashConfirmed(confirmerId, victimId) {
    if (!this.matchActive) return;

    // Accept if there is a matching pending clash or if the confirmer is
    // the target of a pending clash initiated by the victim.
    const pending = this._pendingClashes.get(victimId);
    if (!pending || pending.targetId !== confirmerId) return;

    this._pendingClashes.delete(victimId);
    await this._killPlayer(victimId, confirmerId);
  }

  // ---- tick --------------------------------------------------------------

  // Tick is now a pure state-relay: no movement or collision logic.
  // It broadcasts whatever state the clients last sent us.
  async _tick() {
    if (this.status === 'ending' || this.status === 'ended') return;
    this._lastTick = Date.now();

    const players = await this._allPlayers();

    this._emit('snake-update', {
      players: players.map(publicPlayer),
      scores: this._scores(players),
    });
  }

  async _killPlayer(victimId, killerId) {
    const victim = await this.playerStore.get(victimId);
    if (!victim) return;
    victim.score = 0;
    victim.tailPoints = [];
    victim.spawnedAt = Date.now();
    await this.playerStore.set(victimId, victim);

    if (killerId) {
      const killer = await this.playerStore.get(killerId);
      if (killer) {
        killer.kills = (killer.kills || 0) + 1;
        killer.score += 5;
        await this.playerStore.set(killerId, killer);
      }
    }

    this._emit('snake-hit', { victimId, killerId: killerId || null });

    // Tell the victim's own socket to reset its local state
    this.io.to(victimId).emit('snake-reset', { spawnedAt: victim.spawnedAt });
  }

  // ---- snapshot ----------------------------------------------------------

  async snapshot() {
    const players = await this._allPlayers();
    return {
      gameType: 'snake',
      matchActive: this.matchActive,
      foodCountTarget: this._foodCountTarget,
      foodRespawnIntervalMs: this._foodRespawnIntervalMs,
      bbox: this._bbox,
      foods: this._foods,
      players: players.map(publicPlayer),
      scores: this._scores(players),
      serverNow: Date.now(),
    };
  }

  // ---- helpers -----------------------------------------------------------

  async _allPlayers() {
    return (await this.playerStore.all()).map(([, p]) => p);
  }

  _scores(players) {
    const out = {};
    for (const p of players) {
      out[p.id] = { name: p.name, color: p.color, score: p.score, kills: p.kills };
    }
    return out;
  }

  _spawnPoint() {
    if (!this._bbox) {
      return { lat: this._centerLat || 0, lng: this._centerLng || 0 };
    }
    return {
      lat: this._bbox.south + Math.random() * (this._bbox.north - this._bbox.south),
      lng: this._bbox.west + Math.random() * (this._bbox.east - this._bbox.west),
    };
  }
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    lat: p.lat,
    lng: p.lng,
    heading: p.heading,
    alive: p.alive,
    score: p.score,
    kills: p.kills,
    tailPoints: p.tailPoints || [],
    spawnedAt: p.spawnedAt,
  };
}
