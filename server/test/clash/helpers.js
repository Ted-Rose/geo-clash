// Shared stubs + helpers for the clash test suite.
// Not a *.test.js file — the runner only loads it via imports.

import { GameState } from '../../src/clash/gameState.js';

let roomCounter = 0;

// io stub that records the scope each emit was addressed to
// (roomId for room-wide events, playerId for scoped events like ammo-update).
export function makeIoStub() {
  const events = [];
  return {
    _events: events,
    to: (id) => ({
      emit(event, payload) { events.push({ scope: id, event, payload }); },
    }),
    emit(event, payload) { events.push({ scope: '*', event, payload }); },
  };
}

export function eventsNamed(io, name) {
  return io._events.filter((e) => e.event === name);
}

// Fresh game with in-memory stores. endMatch() is registered on t.after so
// intervals/timeouts never leak across tests.
export function makeGame(t, opts = {}) {
  const io = makeIoStub();
  const roomId = `clash-test-${roomCounter++}`;
  const game = new GameState({ io, roomId, ...opts });
  t.after(() => game.endMatch());
  return { io, game };
}

export function cellCenter(grid, cellId) {
  const cell = grid.cells.find((c) => c.id === cellId);
  const { south, north, west, east } = cell.bounds;
  return { lat: (south + north) / 2, lng: (west + east) / 2 };
}

// Drive one tick with a deterministic dt: dt is derived from
// Date.now() - _lastTick, so backdate _lastTick before calling tick().
export async function tick(game, dtMs) {
  game._lastTick = Date.now() - dtMs;
  await game.tick();
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Put a player at the center of a specific cell via the public API.
export async function placeInCell(game, id, cellId) {
  const c = cellCenter(game.grid, cellId);
  await game.updateLocation(id, c.lat, c.lng);
}

// Mutate a stored player record directly (accepted convention for arranging
// state that has no public setter).
export async function patchPlayer(game, id, patch) {
  const p = await game.playerStore.get(id);
  Object.assign(p, patch);
  await game.playerStore.set(id, p);
  return p;
}
