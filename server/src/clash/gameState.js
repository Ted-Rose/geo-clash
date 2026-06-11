// Authoritative Geo Clash game state + tick loop.
// Holds players, grid ownership, timers. Mutated only by socket handlers
// and the internal tick(); emits patched updates via the provided io.

import { makeRoomStores, leaderboardStore } from '../shared/memoryStore.js';
import {
  buildGrid,
  cellIdAt,
  baseCellId,
} from './gridUtils.js';
import {
  bboxAround,
  distanceMeters,
} from '../shared/gridUtils.js';
import {
  spawnProjectile,
  targetFromHeading,
  PROJECTILE_VMPS,
  HIT_RADIUS_M,
  ATTACK_RANGE_M as PROJECTILE_RANGE_M,
} from './projectiles.js';

const COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#22c55e', // green
  '#eab308', // yellow
  '#a855f7', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

const MATCH_SECONDS = 5 * 60;
const CAPTURE_SECONDS = 5;
const SHIELD_SECONDS = 5;
const TICK_MS = 200;
const ATTACK_CONE_DEG = 25;
const STARTING_LIVES = 3;

export class GameState {
  // Args: { io, roomId, stores?, roomName?, onEnd? }
  constructor({ io, roomId, stores, roomName, onEnd, cellSize = 10, squaresPerSide = 10, maxAmmo = null, ammoRenewalMs = 5000 } = {}) {
    if (!io) throw new Error('GameState: io required');
    if (!roomId) throw new Error('GameState: roomId required');
    this.io = io;
    this.roomId = roomId;
    this.roomName = roomName || roomId;
    const s = stores || makeRoomStores(roomId);
    this.playerStore = s.playerStore;
    this.gridStore = s.gridStore;
    this.projectileStore = s.projectileStore;
    this._onEnd = onEnd || null;
    this.status = 'lobby';
    this.cellSize = cellSize;
    this.squaresPerSide = squaresPerSide;
    this.maxAmmo = (typeof maxAmmo === 'number' && maxAmmo > 0) ? maxAmmo : null;
    this.ammoRenewalMs = (typeof ammoRenewalMs === 'number' && ammoRenewalMs >= 500) ? ammoRenewalMs : 5000;
    this._ammoTimers = new Map();
    this.grid = null;
    this.baseCellId = null;
    this.matchActive = false;
    this.remainingSeconds = MATCH_SECONDS;
    this._tickHandle = null;
    this._lastTick = Date.now();
    this._colorIdx = 0;
  }

  _emit(event, payload) {
    this.io.to(this.roomId).emit(event, payload);
  }

  // ---- bootstrap ---------------------------------------------------------

  async initGrid(centerLat, centerLng, sideMeters) {
    const side = sideMeters ?? this.squaresPerSide * this.cellSize;
    const bbox = bboxAround(centerLat, centerLng, side);
    this.grid = buildGrid(bbox, this.cellSize);
    this.baseCellId = baseCellId(this.grid);
    await this.gridStore.clear();
    for (const cell of this.grid.cells) {
      await this.gridStore.set(cell.id, { ownerId: null, color: null, progress: null });
    }
  }

  async ensureGridFromPlayer(lat, lng) {
    if (!this.grid) await this.initGrid(lat, lng);
  }

  startMatch() {
    if (this.matchActive) return;
    if (this.status === 'ending' || this.status === 'ended') return;
    this.matchActive = true;
    this.status = 'active';
    this.remainingSeconds = MATCH_SECONDS;
    this._lastTick = Date.now();
    if (!this._tickHandle) this._tickHandle = setInterval(() => this.tick().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[clash/gameState] tick error:', err.message);
    }), TICK_MS);
    this._emit('match-start', { remainingSeconds: this.remainingSeconds });
  }

  async endMatch() {
    if (this.status === 'ending' || this.status === 'ended') return;
    this.status = 'ending';
    this.matchActive = false;
    if (this._tickHandle) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
    if (this._projectileTimers) {
      for (const h of this._projectileTimers.values()) clearTimeout(h);
      this._projectileTimers.clear();
    }
    if (this._ammoTimers) {
      for (const h of this._ammoTimers.values()) clearTimeout(h);
      this._ammoTimers.clear();
    }

    let archived = [];
    try {
      const players = (await this.playerStore.all()).map(([, p]) => p);
      const cells = (await this.gridStore.all()).map(([, c]) => c);
      const matchId = `${this.roomId}:${Date.now()}`;
      for (const p of players) {
        const squares = cells.filter((c) => c.ownerId === p.id).length;
        await leaderboardStore.archive({
          playerId: p.id,
          matchId,
          name: p.name,
          color: p.color,
          score: squares,
          metric: 'squares',
          gameType: 'clash',
          finishedAt: Date.now(),
          roomName: this.roomName,
        });
        archived.push({
          id: p.id,
          name: p.name,
          color: p.color,
          squares,
        });
      }
      archived.sort((a, b) => b.squares - a.squares);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[clash/gameState] archive error:', err.message);
    }

    try {
      await Promise.all([
        this.playerStore.clear?.(),
        this.gridStore.clear?.(),
        this.projectileStore?.clear?.(),
      ]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[clash/gameState] purge error:', err.message);
    }

    this._emit('match-end', { scores: this._scores(), leaderboard: archived });
    this.status = 'ended';
    this._onEnd?.();
  }

  // ---- players -----------------------------------------------------------

  async addPlayer(id, name, sessionId) {
    const color = COLORS[this._colorIdx++ % COLORS.length];
    const spawn = this._baseCenter() || { lat: 0, lng: 0 };
    const player = {
      id,
      name: name || `P-${id.slice(0, 4)}`,
      color,
      lat: spawn.lat,
      lng: spawn.lng,
      heading: 0,
      lives: STARTING_LIVES,
      ammo: this.maxAmmo,
      shieldActive: false,
      shieldUntil: 0,
      score: 0,
      alive: true,
      connected: true,
      lastSeen: Date.now(),
      sessionId: sessionId || null,
    };
    await this.playerStore.set(id, player);
    return player;
  }

  async getPlayerBySessionId(sessionId) {
    if (!sessionId) return null;
    for (const [socketId, p] of await this.playerStore.all()) {
      if (p.sessionId === sessionId) return { player: p, socketId };
    }
    return null;
  }

  async swapSocketId(oldId, newId) {
    const p = await this.playerStore.get(oldId);
    if (!p) return;
    p.id = newId;
    p.connected = true;
    await this.playerStore.set(newId, p);
    await this.playerStore.del(oldId);
    for (const [cid, cell] of await this.gridStore.all()) {
      let changed = false;
      if (cell.ownerId === oldId) {
        cell.ownerId = newId;
        changed = true;
      }
      if (cell.progress && cell.progress.playerId === oldId) {
        cell.progress.playerId = newId;
        changed = true;
      }
      if (changed) await this.gridStore.set(cid, cell);
    }
  }

  async removePlayer(id) {
    const p = await this.playerStore.get(id);
    if (!p) return;
    await this.playerStore.del(id);
    for (const [cid, cell] of await this.gridStore.all()) {
      if (cell && cell.progress?.playerId === id) {
        cell.progress = null;
        await this.gridStore.set(cid, cell);
      }
    }
  }

  async updateLocation(id, lat, lng, heading) {
    const p = await this.playerStore.get(id);
    if (!p || !p.alive) return;
    p.lat = lat;
    p.lng = lng;
    if (typeof heading === 'number') p.heading = heading;
    p.lastSeen = Date.now();
    await this.playerStore.set(id, p);
    if (!this.grid) await this.initGrid(lat, lng);
  }

  async activateShield(id) {
    const p = await this.playerStore.get(id);
    if (!p || !p.alive) return;
    p.shieldActive = true;
    p.shieldUntil = Date.now() + SHIELD_SECONDS * 1000;
    await this.playerStore.set(id, p);
    this._emit('player-shield', { id, until: p.shieldUntil });
  }

  async attack(id, { heading, target } = {}) {
    if (this.status === 'ending' || this.status === 'ended') return;
    const attacker = await this.playerStore.get(id);
    if (!attacker || !attacker.alive) return;
    if (this.maxAmmo !== null) {
      const cur = attacker.ammo ?? this.maxAmmo;
      if (cur <= 0) return;
      attacker.ammo = cur - 1;
      await this.playerStore.set(id, attacker);
      this.io.to(id).emit('ammo-update', { ammo: attacker.ammo, maxAmmo: this.maxAmmo });
      this._scheduleAmmoRecharge(id);
    }
    const dir = typeof heading === 'number' ? heading : attacker.heading || 0;

    let resolvedTarget = null;
    if (target && typeof target.lat === 'number' && typeof target.lng === 'number') {
      const dist = distanceMeters(attacker, target);
      if (dist > PROJECTILE_RANGE_M) {
        const scale = PROJECTILE_RANGE_M / dist;
        resolvedTarget = {
          lat: attacker.lat + (target.lat - attacker.lat) * scale,
          lng: attacker.lng + (target.lng - attacker.lng) * scale,
        };
      } else {
        resolvedTarget = { lat: target.lat, lng: target.lng };
      }
    } else {
      let bestEnemy = null;
      let bestDist = Infinity;
      for (const [, p] of await this.playerStore.all()) {
        if (p.id === id || !p.alive) continue;
        const d = distanceMeters(attacker, p);
        if (d > PROJECTILE_RANGE_M) continue;
        const bearing = bearingDeg(attacker, p);
        const delta = Math.abs(angleDelta(bearing, dir));
        if (delta <= ATTACK_CONE_DEG && d < bestDist) {
          bestDist = d;
          bestEnemy = p;
        }
      }
      resolvedTarget = bestEnemy
        ? { lat: bestEnemy.lat, lng: bestEnemy.lng }
        : targetFromHeading(attacker, dir, PROJECTILE_RANGE_M);
    }

    const proj = spawnProjectile({ attacker, target: resolvedTarget, vMps: PROJECTILE_VMPS });
    await this.projectileStore.set(proj.id, proj);
    this._emit('projectile-spawn', proj);
    this._scheduleResolution(proj);
  }

  _scheduleAmmoRecharge(playerId) {
    const key = `${playerId}:${Date.now()}:${Math.random()}`;
    const handle = setTimeout(async () => {
      this._ammoTimers?.delete(key);
      if (this.maxAmmo === null) return;
      const p = await this.playerStore.get(playerId);
      if (!p) return;
      p.ammo = Math.min(this.maxAmmo, (p.ammo ?? 0) + 1);
      await this.playerStore.set(playerId, p);
      this.io.to(playerId).emit('ammo-update', { ammo: p.ammo, maxAmmo: this.maxAmmo });
    }, this.ammoRenewalMs);
    if (typeof handle.unref === 'function') handle.unref();
    this._ammoTimers.set(key, handle);
  }

  _scheduleResolution(proj) {
    const delay = Math.max(0, proj.tArrival - Date.now());
    if (!this._projectileTimers) this._projectileTimers = new Map();
    const handle = setTimeout(() => {
      this._projectileTimers?.delete(proj.id);
      this._resolveProjectile(proj.id).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[clash/gameState] resolve error:', err.message);
      });
    }, delay);
    if (typeof handle.unref === 'function') handle.unref();
    this._projectileTimers.set(proj.id, handle);
  }

  async _resolveProjectile(projectileId) {
    if (this.status === 'ending' || this.status === 'ended') return;
    const proj = await this.projectileStore.get(projectileId);
    if (!proj || proj.status !== 'in-flight') return;
    const now = Date.now();

    let victim = null;
    let bestDist = Infinity;
    for (const [, p] of await this.playerStore.all()) {
      if (p.id === proj.attackerId || !p.alive) continue;
      const d = distanceMeters(proj.target, p);
      if (d <= HIT_RADIUS_M && d < bestDist) {
        bestDist = d;
        victim = p;
      }
    }

    let outcome = 'expired';
    let victimId = null;
    if (victim) {
      victimId = victim.id;
      const shielded = victim.shieldActive && victim.shieldUntil > now;
      if (shielded) {
        outcome = 'blocked';
      } else {
        outcome = 'hit';
        victim.lives = Math.max(0, victim.lives - 1);
        if (victim.lives === 0) victim.alive = false;
        await this.playerStore.set(victim.id, victim);
        this._emit('player-hit', {
          id: victim.id,
          lives: victim.lives,
          alive: victim.alive,
        });
      }
    }

    proj.status = outcome;
    await this.projectileStore.del(projectileId);
    this._emit('projectile-resolved', { id: proj.id, outcome, victimId });
  }

  async respawn(id) {
    const p = await this.playerStore.get(id);
    if (!p) return;
    if (!this.grid) return;
    const cid = cellIdAt(this.grid, p.lat, p.lng);
    if (cid !== this.baseCellId) {
      this._emit('respawn-denied', { id, reason: 'not-at-base' });
      return;
    }
    p.lives = STARTING_LIVES;
    p.alive = true;
    p.shieldActive = false;
    if (this.maxAmmo !== null) p.ammo = this.maxAmmo;
    await this.playerStore.set(id, p);
    this._emit('player-respawn', { id, lives: p.lives });
    if (this.maxAmmo !== null) {
      this.io.to(id).emit('ammo-update', { ammo: p.ammo, maxAmmo: this.maxAmmo });
    }
  }

  // ---- tick --------------------------------------------------------------

  async tick() {
    if (this.status === 'ending' || this.status === 'ended') return;
    const now = Date.now();
    const dt = now - this._lastTick;
    this._lastTick = now;

    for (const [, p] of await this.playerStore.all()) {
      if (p.shieldActive && p.shieldUntil <= now) {
        p.shieldActive = false;
        await this.playerStore.set(p.id, p);
        this._emit('player-shield-end', { id: p.id });
      }
    }

    if (this.grid && this.matchActive) {
      const players = (await this.playerStore.all()).map(([, p]) => p);
      const occupiedCells = new Map();
      for (const p of players) {
        if (!p.alive) continue;
        const cid = cellIdAt(this.grid, p.lat, p.lng);
        if (!cid) continue;
        if (!occupiedCells.has(cid)) occupiedCells.set(cid, []);
        occupiedCells.get(cid).push(p);
      }

      const updates = [];
      for (const [cid, occupants] of occupiedCells) {
        const cell = await this.gridStore.get(cid);
        if (!cell) continue;
        const teams = new Set(occupants.map((p) => p.color));
        if (teams.size > 1) continue;
        if (occupants.every((p) => !p.connected)) continue;
        const claimant = occupants[0];
        if (cell.ownerId === claimant.id) continue;
        if (!cell.progress || cell.progress.playerId !== claimant.id) {
          cell.progress = {
            playerId: claimant.id,
            color: claimant.color,
            elapsedMs: 0,
          };
          this._emit('cell-capture-start', { cellId: cid, playerId: claimant.id, color: claimant.color });
        }
        cell.progress.elapsedMs += dt;
        if (cell.progress.elapsedMs >= CAPTURE_SECONDS * 1000) {
          cell.ownerId = claimant.id;
          cell.color = claimant.color;
          cell.progress = null;
          updates.push({ id: cid, ownerId: cell.ownerId, color: cell.color });
        }
        await this.gridStore.set(cid, cell);
      }

      for (const [cid, cell] of await this.gridStore.all()) {
        if (cell.progress && !occupiedCells.has(cid)) {
          cell.progress = null;
          await this.gridStore.set(cid, cell);
        }
      }

      if (updates.length) {
        await this._recountScores();
        this._emit('grid-update', { cells: updates, scores: this._scores() });
      }
    }

    this._emit('players-update', {
      players: (await this.playerStore.all()).map(([, p]) => publicPlayer(p)).filter(Boolean),
    });

    if (this.matchActive) {
      this.remainingSeconds = Math.max(0, this.remainingSeconds - dt / 1000);
      this._emit('timer', { remainingSeconds: this.remainingSeconds });
      if (this.remainingSeconds <= 0) this.endMatch();
    }
  }

  // ---- snapshots ---------------------------------------------------------

  async snapshot() {
    await this._recountScores();
    const players = (await this.playerStore.all()).map(([, p]) => publicPlayer(p)).filter(Boolean);
    const cells = (await this.gridStore.all()).map(([id, c]) => ({
      id,
      ownerId: c.ownerId,
      color: c.color,
    }));
    const now = Date.now();
    const projectiles = (await this.projectileStore.all())
      .map(([, p]) => p)
      .filter((p) => p.status === 'in-flight' && p.tArrival > now);
    return {
      grid: this.grid
        ? {
            rows: this.grid.rows,
            cols: this.grid.cols,
            cellMeters: this.grid.cellMeters,
            bbox: this.grid.bbox,
            cells: this.grid.cells.map((c) => ({ id: c.id, polygon: c.polygon })),
            baseCellId: this.baseCellId,
          }
        : null,
      players,
      ownership: cells,
      projectiles,
      scores: this._scores(),
      matchActive: this.matchActive,
      remainingSeconds: this.remainingSeconds,
      serverNow: now,
      maxAmmo: this.maxAmmo,
      ammoRenewalMs: this.maxAmmo !== null ? this.ammoRenewalMs : null,
    };
  }

  // ---- helpers -----------------------------------------------------------

  _baseCenter() {
    if (!this.grid) return null;
    const cell = this.grid.cells.find((c) => c.id === this.baseCellId);
    if (!cell) return null;
    const { south, north, west, east } = cell.bounds;
    return { lat: (south + north) / 2, lng: (west + east) / 2 };
  }

  _scores() {
    const tally = {};
    for (const [, p] of this._lastPlayersCache || []) {
      if (!p) continue;
      tally[p.id] = { name: p.name, color: p.color, squares: 0 };
    }
    for (const [, c] of this._lastCellsCache || []) {
      if (c && c.ownerId && tally[c.ownerId]) {
        tally[c.ownerId].squares += 1;
      }
    }
    return tally;
  }

  async _recountScores() {
    try {
      this._lastPlayersCache = await this.playerStore.all();
      this._lastCellsCache = await this.gridStore.all();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[clash/gameState] recountScores error:', err.message);
    }
  }
}

function publicPlayer(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    lat: p.lat,
    lng: p.lng,
    heading: p.heading,
    lives: p.lives,
    ammo: p.ammo ?? null,
    shieldActive: p.shieldActive,
    alive: p.alive,
    connected: p.connected !== false,
  };
}

function bearingDeg(from, to) {
  const φ1 = from.lat * Math.PI / 180;
  const φ2 = to.lat * Math.PI / 180;
  const λ1 = from.lng * Math.PI / 180;
  const λ2 = to.lng * Math.PI / 180;
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function angleDelta(a, b) {
  let d = ((a - b + 540) % 360) - 180;
  return d;
}
