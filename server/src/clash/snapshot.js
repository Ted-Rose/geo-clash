// Read-model for Geo Clash: the join/reconnect snapshot payload and the
// public-player projection. Pure reads against the room stores.

import { recountScores, scores } from './capture.js';

// Strip a stored player down to the fields clients may see.
export function publicPlayer(p) {
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

// Full room snapshot for a joining/reconnecting client.
export async function buildSnapshot(state) {
  await recountScores(state);
  const players = (await state.playerStore.all())
    .map(([, p]) => publicPlayer(p))
    .filter(Boolean);
  const cells = (await state.gridStore.all()).map(([id, c]) => ({
    id,
    ownerId: c.ownerId,
    color: c.color,
  }));
  const now = Date.now();
  const projectiles = (await state.projectileStore.all())
    .map(([, p]) => p)
    .filter((p) => p.status === 'in-flight' && p.tArrival > now);
  return {
    grid: state.grid
      ? {
          rows: state.grid.rows,
          cols: state.grid.cols,
          cellMeters: state.grid.cellMeters,
          bbox: state.grid.bbox,
          cells: state.grid.cells
            .map((c) => ({ id: c.id, polygon: c.polygon })),
          baseCellId: state.baseCellId,
        }
      : null,
    players,
    ownership: cells,
    projectiles,
    scores: scores(state),
    matchActive: state.matchActive,
    remainingSeconds: state.remainingSeconds,
    serverNow: now,
    maxAmmo: state.maxAmmo,
    ammoRenewalMs: state.maxAmmo !== null ? state.ammoRenewalMs : null,
  };
}
