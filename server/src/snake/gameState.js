// Authoritative Geo Snake game state + tick loop.
// Each player is a GPS-tracked snake. Moving grows the tail; eating food
// scores a point; colliding with another's tail or head kills you.

import { ulid } from 'ulid';
import { makeRoomStores, leaderboardStore } from '../shared/memoryStore.js';
import { bboxAround, distanceMeters } from '../shared/gridUtils.js';
import { replenishFood, isEaten } from './food.js';
import { collidesWithTail } from './collisions.js';
import {
  FOOD_RESPAWN_INTERVAL_MS,
  FOOD_SPAWN_RADIUS_M,
  TICK_MS,
  MIN_MOVE_M,
  MAX_TAIL_SEGMENTS,
  TAIL_METERS_PER_SCORE,
  FOOD_COUNT_TARGET,
  FOOD_SCORE_PER_ITEM,
  SPAWN_GRACE_MS,
  COLLISION_RADIUS_M,
  COLORS,
} from './constants.js';

export class SnakeGameState {
  constructor({
    io,
    roomId,
    roomName,
    stores,
    onEnd,
    centerLat,
    centerLng,
    arenaSideMeters = 200,
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

  async updateLocation(id, lat, lng, heading) {
    const p = await this.playerStore.get(id);
    if (!p) return;
    if (!this._bbox) this._initArena(lat, lng);
    const prevLat = p.lat;
    const prevLng = p.lng;
    p.lat = lat;
    p.lng = lng;
    if (typeof heading === 'number') p.heading = heading;
    p.lastSeen = Date.now();
    if (p.alive && this.matchActive) {
      const moved = distanceMeters({ lat: prevLat, lng: prevLng }, { lat, lng });
      if (moved >= MIN_MOVE_M) {
        p.tailPoints = p.tailPoints || [];
        p.tailPoints.push({ lat: prevLat, lng: prevLng });
        const maxTailLenM = p.score * TAIL_METERS_PER_SCORE;
        if (maxTailLenM <= 0) {
          p.tailPoints = [];
        } else {
          let totalLen = 0;
          for (let i = 1; i < p.tailPoints.length; i++) {
            totalLen += distanceMeters(
              p.tailPoints[i - 1], p.tailPoints[i]
            );
          }
          while (p.tailPoints.length > 1 && totalLen > maxTailLenM) {
            totalLen -= distanceMeters(
              p.tailPoints[0], p.tailPoints[1]
            );
            p.tailPoints.shift();
          }
          if (p.tailPoints.length > MAX_TAIL_SEGMENTS) {
            p.tailPoints = p.tailPoints.slice(
              p.tailPoints.length - MAX_TAIL_SEGMENTS
            );
          }
        }
      }
    }
    await this.playerStore.set(id, p);
  }

  // ---- tick --------------------------------------------------------------

  async _tick() {
    if (this.status === 'ending' || this.status === 'ended') return;
    const now = Date.now();
    const dt = now - this._lastTick;
    this._lastTick = now;

    const players = await this._allPlayers();
    const alive = players.filter((p) => p.alive);

    // Food consumption
    const eatenIds = new Set();
    for (const p of alive) {
      if (!p.alive) continue;
      const head = { lat: p.lat, lng: p.lng };
      for (let i = 0; i < this._foods.length; i++) {
        const food = this._foods[i];
        if (eatenIds.has(food.id)) continue;
        if (isEaten(head, food)) {
          p.score += FOOD_SCORE_PER_ITEM;
          eatenIds.add(food.id);
          await this.playerStore.set(p.id, p);
          this._emit('snake-ate', { playerId: p.id, foodId: food.id, score: p.score });
        }
      }
    }
    if (eatenIds.size > 0) {
      this._foods = this._foods.filter((f) => !eatenIds.has(f.id));
      this._emit('food-update', { foods: this._foods });
    }

    // Collision detection
    const playerMap = {};
    for (const p of alive) playerMap[p.id] = p;

    for (const p of alive) {
      const head = { lat: p.lat, lng: p.lng };
      const graceExpired = (now - (p.spawnedAt || 0)) >= SPAWN_GRACE_MS;
      if (!graceExpired) continue;

      // Head-on-tail of others
      for (const other of alive) {
        if (other.id === p.id) continue;
        if (other.tailPoints && collidesWithTail(head, other.tailPoints)) {
          await this._killPlayer(p.id, other.id);
          break;
        }
        // Head-on-head
        const d = distanceMeters(head, { lat: other.lat, lng: other.lng });
        if (d <= COLLISION_RADIUS_M) {
          await this._killPlayer(p.id, null);
          await this._killPlayer(other.id, null);
          break;
        }
      }
    }

    // Last-alive check
    const updatedPlayers = await this._allPlayers();
    const stillAlive = updatedPlayers.filter((p) => p.alive);
    if (this.matchActive && updatedPlayers.length > 1 && stillAlive.length <= 1) {
      await this.endMatch();
      return;
    }

    // Broadcast
    this._emit('snake-update', {
      players: updatedPlayers.map(publicPlayer),
      scores: this._scores(updatedPlayers),
    });
  }

  async _killPlayer(victimId, killerId) {
    const victim = await this.playerStore.get(victimId);
    if (!victim || !victim.alive) return;
    victim.alive = false;
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
    this._emit('snake-died', { victimId, killerId: killerId || null });
    // Auto-respawn after a short delay
    setTimeout(async () => {
      const p = await this.playerStore.get(victimId);
      if (!p || this.status === 'ended') return;
      const spawn = this._spawnPoint();
      p.alive = true;
      p.lat = spawn.lat;
      p.lng = spawn.lng;
      p.tailPoints = [];
      p.spawnedAt = Date.now();
      await this.playerStore.set(victimId, p);
      this._emit('snake-respawn', { playerId: victimId });
    }, 3000);
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
