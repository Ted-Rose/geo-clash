// Authoritative Geo Clash game state + tick loop.
// Holds players, grid ownership, timers. Mutated only by socket handlers
// and the internal tick(); emits patched updates via the provided io.

import { makeRoomStores } from '../shared/memoryStore.js';
import {
  buildGrid,
  cellIdAt,
  baseCellId,
} from './gridUtils.js';
import { bboxAround } from '../shared/gridUtils.js';
import { processCaptures } from './capture.js';
import {
  attack as runAttack,
  scheduleAmmoRecharge,
  scheduleResolution,
  resolveProjectile,
} from './combat.js';
import { endMatch as teardownMatch } from './lifecycle.js';
import { buildSnapshot, publicPlayer } from './snapshot.js';

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
const SHIELD_SECONDS = 5;
const TICK_MS = 200;
const STARTING_LIVES = 3;

export class GameState {
  // Args: { io, roomId, stores?, roomName?, onEnd? }
  constructor({
    io, roomId, stores, roomName, onEnd,
    cellSize = 10, squaresPerSide = 10,
    maxAmmo = null, ammoRenewalMs = 5000,
  } = {}) {
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
    const validAmmo = typeof maxAmmo === 'number' && maxAmmo > 0;
    this.maxAmmo = validAmmo ? maxAmmo : null;
    const validRenewal =
      typeof ammoRenewalMs === 'number' && ammoRenewalMs >= 500;
    this.ammoRenewalMs = validRenewal ? ammoRenewalMs : 5000;
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
      await this.gridStore.set(cell.id, {
        ownerId: null, color: null, progress: null,
      });
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
    if (!this._tickHandle) {
      this._tickHandle = setInterval(() => this.tick().catch((err) => {
        console.error('[clash/gameState] tick error:', err.message);
      }), TICK_MS);
    }
    this._emit('match-start', { remainingSeconds: this.remainingSeconds });
  }

  // Teardown lives in lifecycle.js; kept as a delegating method because
  // socket handlers and tests call game.endMatch() directly.
  endMatch() {
    return teardownMatch(this);
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
    // Pending ammo recharges keep the player's remaining delay but must
    // resolve against (and emit to) the new socket id at fire time.
    for (const rec of this._ammoTimers.values()) {
      if (rec.playerId === oldId) rec.playerId = newId;
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

  // ---- combat (see combat.js) ---------------------------------------------

  attack(id, opts) {
    return runAttack(this, id, opts);
  }

  _scheduleAmmoRecharge(playerId) {
    scheduleAmmoRecharge(this, playerId);
  }

  _scheduleResolution(proj) {
    scheduleResolution(this, proj);
  }

  _resolveProjectile(projectileId) {
    return resolveProjectile(this, projectileId);
  }

  async respawn(id) {
    const p = await this.playerStore.get(id);
    if (!p) return;
    if (p.alive) return;
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
      this.io.to(id).emit('ammo-update', {
        ammo: p.ammo, maxAmmo: this.maxAmmo,
      });
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

    // Occupancy → capture-progress → grid-update (see capture.js).
    await processCaptures(this, dt);

    this._emit('players-update', {
      players: (await this.playerStore.all())
        .map(([, p]) => publicPlayer(p))
        .filter(Boolean),
    });

    if (this.matchActive) {
      this.remainingSeconds = Math.max(0, this.remainingSeconds - dt / 1000);
      this._emit('timer', { remainingSeconds: this.remainingSeconds });
      if (this.remainingSeconds <= 0) this.endMatch();
    }
  }

  // ---- snapshots ---------------------------------------------------------

  // Read-model assembly lives in snapshot.js.
  snapshot() {
    return buildSnapshot(this);
  }

  // ---- helpers -----------------------------------------------------------

  _baseCenter() {
    if (!this.grid) return null;
    const cell = this.grid.cells.find((c) => c.id === this.baseCellId);
    if (!cell) return null;
    const { south, north, west, east } = cell.bounds;
    return { lat: (south + north) / 2, lng: (west + east) / 2 };
  }

}

