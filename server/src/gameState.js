// Authoritative game state + tick loop.
// Holds players, grid ownership, timers. Mutated only by socket handlers
// and the internal tick(); emits patched updates via the provided io.

import { playerStore, gridStore } from './memoryStore.js';
import {
  buildGrid,
  cellIdAt,
  baseCellId,
  bboxAround,
  distanceMeters,
} from './gridUtils.js';

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
const ATTACK_RANGE_M = 30;     // arrows fly ~30m
const ATTACK_CONE_DEG = 25;    // half-angle of the hit cone
const STARTING_LIVES = 3;

export class GameState {
  constructor(io) {
    this.io = io;
    this.grid = null;          // { rows, cols, bbox, cells, cellMeters }
    this.baseCellId = null;
    this.matchActive = false;
    this.remainingSeconds = MATCH_SECONDS;
    this._tickHandle = null;
    this._lastTick = Date.now();
    this._colorIdx = 0;
  }

  // ---- bootstrap ---------------------------------------------------------

  async initGrid(centerLat, centerLng, sideMeters = 120) {
    const bbox = bboxAround(centerLat, centerLng, sideMeters);
    this.grid = buildGrid(bbox);
    this.baseCellId = baseCellId(this.grid);
    await gridStore.clear();
    // Each cell entry: { ownerId, color, progress: { playerId, color, elapsedMs } | null }
    for (const cell of this.grid.cells) {
      await gridStore.set(cell.id, { ownerId: null, color: null, progress: null });
    }
  }

  async ensureGridFromPlayer(lat, lng) {
    if (!this.grid) await this.initGrid(lat, lng);
  }

  startMatch() {
    if (this.matchActive) return;
    this.matchActive = true;
    this.remainingSeconds = MATCH_SECONDS;
    this._lastTick = Date.now();
    if (!this._tickHandle) this._tickHandle = setInterval(() => this.tick(), TICK_MS);
    this.io.emit('match-start', { remainingSeconds: this.remainingSeconds });
  }

  endMatch() {
    this.matchActive = false;
    if (this._tickHandle) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
    this.io.emit('match-end', { scores: this._scores() });
  }

  // ---- players -----------------------------------------------------------

  async addPlayer(id, name) {
    const color = COLORS[this._colorIdx++ % COLORS.length];
    // Spawn at base cell center if grid exists, otherwise (0,0) placeholder.
    const spawn = this._baseCenter() || { lat: 0, lng: 0 };
    const player = {
      id,
      name: name || `P-${id.slice(0, 4)}`,
      color,
      lat: spawn.lat,
      lng: spawn.lng,
      heading: 0,
      lives: STARTING_LIVES,
      shieldActive: false,
      shieldUntil: 0,
      score: 0,
      alive: true,
      lastSeen: Date.now(),
    };
    await playerStore.set(id, player);
    return player;
  }

  async removePlayer(id) {
    const p = await playerStore.get(id);
    if (!p) return;
    await playerStore.del(id);
    // Drop in-progress captures owned by this player.
    for (const [cid, cell] of await gridStore.all()) {
      if (cell.progress?.playerId === id) {
        cell.progress = null;
        await gridStore.set(cid, cell);
      }
    }
  }

  async updateLocation(id, lat, lng, heading) {
    const p = await playerStore.get(id);
    if (!p || !p.alive) return;
    p.lat = lat;
    p.lng = lng;
    if (typeof heading === 'number') p.heading = heading;
    p.lastSeen = Date.now();
    await playerStore.set(id, p);
    if (!this.grid) await this.initGrid(lat, lng); // first player defines arena
  }

  async activateShield(id) {
    const p = await playerStore.get(id);
    if (!p || !p.alive) return;
    p.shieldActive = true;
    p.shieldUntil = Date.now() + SHIELD_SECONDS * 1000;
    await playerStore.set(id, p);
    this.io.emit('player-shield', { id, until: p.shieldUntil });
  }

  // Fire an arrow in `heading` (degrees, 0 = north, clockwise). Hits the
  // closest unshielded enemy inside the cone.
  async attack(id, heading) {
    const attacker = await playerStore.get(id);
    if (!attacker || !attacker.alive) return;
    const dir = typeof heading === 'number' ? heading : attacker.heading || 0;

    let bestTarget = null;
    let bestDist = Infinity;
    for (const [, p] of await playerStore.all()) {
      if (p.id === id || !p.alive) continue;
      const d = distanceMeters(attacker, p);
      if (d > ATTACK_RANGE_M) continue;
      const bearing = bearingDeg(attacker, p);
      const delta = Math.abs(angleDelta(bearing, dir));
      if (delta <= ATTACK_CONE_DEG && d < bestDist) {
        bestDist = d;
        bestTarget = p;
      }
    }

    this.io.emit('player-attack', {
      attackerId: id,
      heading: dir,
      from: { lat: attacker.lat, lng: attacker.lng },
      hitId: bestTarget?.id || null,
    });

    if (!bestTarget) return;
    if (bestTarget.shieldActive && bestTarget.shieldUntil > Date.now()) {
      this.io.emit('shield-block', { id: bestTarget.id });
      return;
    }
    bestTarget.lives = Math.max(0, bestTarget.lives - 1);
    if (bestTarget.lives === 0) bestTarget.alive = false;
    await playerStore.set(bestTarget.id, bestTarget);
    this.io.emit('player-hit', {
      id: bestTarget.id,
      lives: bestTarget.lives,
      alive: bestTarget.alive,
    });
  }

  async respawn(id) {
    const p = await playerStore.get(id);
    if (!p) return;
    if (!this.grid) return;
    const cid = cellIdAt(this.grid, p.lat, p.lng);
    if (cid !== this.baseCellId) {
      this.io.emit('respawn-denied', { id, reason: 'not-at-base' });
      return;
    }
    p.lives = STARTING_LIVES;
    p.alive = true;
    p.shieldActive = false;
    await playerStore.set(id, p);
    this.io.emit('player-respawn', { id, lives: p.lives });
  }

  // ---- tick: capture progress + timer ------------------------------------

  async tick() {
    const now = Date.now();
    const dt = now - this._lastTick;
    this._lastTick = now;

    // expire shields
    for (const [, p] of await playerStore.all()) {
      if (p.shieldActive && p.shieldUntil <= now) {
        p.shieldActive = false;
        await playerStore.set(p.id, p);
        this.io.emit('player-shield-end', { id: p.id });
      }
    }

    // ---- grid capture progression
    // For each living player, look up the cell they're standing in.
    // If they're in an unowned-or-enemy cell, advance progress; once we hit
    // CAPTURE_SECONDS, ownership flips and we emit grid-update.
    if (this.grid && this.matchActive) {
      const players = (await playerStore.all()).map(([, p]) => p);
      const occupiedCells = new Map(); // cellId -> [players]
      for (const p of players) {
        if (!p.alive) continue;
        const cid = cellIdAt(this.grid, p.lat, p.lng);
        if (!cid) continue;
        if (!occupiedCells.has(cid)) occupiedCells.set(cid, []);
        occupiedCells.get(cid).push(p);
      }

      const updates = [];
      for (const [cid, occupants] of occupiedCells) {
        const cell = await gridStore.get(cid);
        if (!cell) continue;
        // Contested: more than one team color present -> freeze progress.
        const teams = new Set(occupants.map((p) => p.color));
        if (teams.size > 1) continue;
        const claimant = occupants[0];
        if (cell.ownerId === claimant.id) continue;
        // start or continue progress for this claimant
        if (!cell.progress || cell.progress.playerId !== claimant.id) {
          cell.progress = {
            playerId: claimant.id,
            color: claimant.color,
            elapsedMs: 0,
          };
        }
        cell.progress.elapsedMs += dt;
        if (cell.progress.elapsedMs >= CAPTURE_SECONDS * 1000) {
          cell.ownerId = claimant.id;
          cell.color = claimant.color;
          cell.progress = null;
          updates.push({ id: cid, ownerId: cell.ownerId, color: cell.color });
        }
        await gridStore.set(cid, cell);
      }

      // decay progress for cells that nobody is standing in this tick
      for (const [cid, cell] of await gridStore.all()) {
        if (cell.progress && !occupiedCells.has(cid)) {
          cell.progress = null;
          await gridStore.set(cid, cell);
        }
      }

      if (updates.length) {
        await this._recountScores();
        this.io.emit('grid-update', { cells: updates, scores: this._scores() });
      }
    }

    // broadcast lightweight player snapshot every tick
    this.io.emit('players-update', {
      players: (await playerStore.all()).map(([, p]) => publicPlayer(p)),
    });

    // match countdown
    if (this.matchActive) {
      this.remainingSeconds = Math.max(0, this.remainingSeconds - dt / 1000);
      this.io.emit('timer', { remainingSeconds: this.remainingSeconds });
      if (this.remainingSeconds <= 0) this.endMatch();
    }
  }

  // ---- snapshots ---------------------------------------------------------

  async snapshot() {
    await this._recountScores();
    const players = (await playerStore.all()).map(([, p]) => publicPlayer(p));
    const cells = (await gridStore.all()).map(([id, c]) => ({
      id,
      ownerId: c.ownerId,
      color: c.color,
    }));
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
      scores: this._scores(),
      matchActive: this.matchActive,
      remainingSeconds: this.remainingSeconds,
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
    // computed against current store snapshot synchronously via cached values
    for (const [, p] of this._lastPlayersCache || []) tally[p.id] = { name: p.name, color: p.color, squares: 0 };
    for (const [, c] of this._lastCellsCache || []) {
      if (c.ownerId && tally[c.ownerId]) tally[c.ownerId].squares += 1;
    }
    return tally;
  }

  async _recountScores() {
    this._lastPlayersCache = await playerStore.all();
    this._lastCellsCache = await gridStore.all();
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
    lives: p.lives,
    shieldActive: p.shieldActive,
    alive: p.alive,
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
