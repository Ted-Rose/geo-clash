// Capture progression + score tallying for Geo Clash.
// Free functions that take the GameState instance — the class keeps
// store ownership and emits; this module owns the per-tick capture rules.

import { cellIdAt } from './gridUtils.js';

const CAPTURE_SECONDS = 5;

// Advance capture progress for every occupied cell, claim cells whose
// progress has completed, purge stale progress on abandoned cells, and
// broadcast a grid-update when ownership changed. `playerEntries` is the
// per-tick playerStore.all() snapshot hoisted by tick() — pass it so a
// tick costs one store read instead of three.
export async function processCaptures(state, dt, playerEntries) {
  if (!state.grid || !state.matchActive) return;

  const entries = playerEntries ?? (await state.playerStore.all());
  const players = entries.map(([, p]) => p);
  const occupiedCells = new Map();
  for (const p of players) {
    if (!p.alive) continue;
    const cid = cellIdAt(state.grid, p.lat, p.lng);
    if (!cid) continue;
    if (!occupiedCells.has(cid)) occupiedCells.set(cid, []);
    occupiedCells.get(cid).push(p);
  }

  const updates = [];
  for (const [cid, occupants] of occupiedCells) {
    const cell = await state.gridStore.get(cid);
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
      state._emit('cell-capture-start', {
        cellId: cid, playerId: claimant.id, color: claimant.color,
      });
    }
    cell.progress.elapsedMs += dt;
    if (cell.progress.elapsedMs >= CAPTURE_SECONDS * 1000) {
      cell.ownerId = claimant.id;
      cell.color = claimant.color;
      cell.progress = null;
      updates.push({ id: cid, ownerId: cell.ownerId, color: cell.color });
    }
    await state.gridStore.set(cid, cell);
  }

  const cellEntries = await state.gridStore.all();
  for (const [cid, cell] of cellEntries) {
    if (cell.progress && !occupiedCells.has(cid)) {
      cell.progress = null;
      await state.gridStore.set(cid, cell);
    }
  }

  if (updates.length) {
    // Tally from the lists fetched this tick — a departed player drops
    // out of scores without an extra recount round-trip.
    state._emit('grid-update', {
      cells: updates,
      scores: tallyScores(entries, cellEntries),
    });
  }
}

// Pure tally of owned squares per player from store-entry lists
// ([id, value] pairs as returned by store.all()).
export function tallyScores(playerEntries, cellEntries) {
  const tally = {};
  for (const [, p] of playerEntries || []) {
    if (!p) continue;
    tally[p.id] = { name: p.name, color: p.color, squares: 0 };
  }
  for (const [, c] of cellEntries || []) {
    if (c && c.ownerId && tally[c.ownerId]) {
      tally[c.ownerId].squares += 1;
    }
  }
  return tally;
}

// Tally owned squares per player from the cached store snapshots.
export function scores(state) {
  return tallyScores(state._lastPlayersCache, state._lastCellsCache);
}

// Refresh the caches that scores() reads.
export async function recountScores(state) {
  try {
    state._lastPlayersCache = await state.playerStore.all();
    state._lastCellsCache = await state.gridStore.all();
  } catch (err) {
    console.error('[clash/capture] recountScores error:', err.message);
  }
}
