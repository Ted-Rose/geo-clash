import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame } from './helpers.js';

test('snapshot in lobby returns grid:null and inert fields', async (t) => {
  const { game } = makeGame(t); // no initGrid, no players
  const snap = await game.snapshot();
  assert.equal(snap.grid, null);
  assert.deepEqual(snap.players, []);
  assert.deepEqual(snap.ownership, []);
  assert.deepEqual(snap.projectiles, []);
  assert.equal(snap.matchActive, false);
  assert.equal(snap.remainingSeconds, 300);
  assert.equal(snap.maxAmmo, null);
  assert.equal(snap.ammoRenewalMs, null);
  assert.equal(typeof snap.serverNow, 'number');
});

test('snapshot exposes full grid meta, public players, ownership and ammo fields', async (t) => {
  const { game } = makeGame(t, { maxAmmo: 3, ammoRenewalMs: 5000 });
  await game.initGrid(51.5, -0.12);
  const a = await game.addPlayer('A', 'Alice', 'sess-1');
  await game.gridStore.set('0_0', {
    ownerId: 'A',
    color: a.color,
    progress: { playerId: 'A', color: a.color, elapsedMs: 100 },
  });

  const snap = await game.snapshot();
  assert.equal(snap.grid.rows, game.grid.rows);
  assert.equal(snap.grid.cols, game.grid.cols);
  assert.equal(snap.grid.cellMeters, 10);
  assert.deepEqual(snap.grid.bbox, game.grid.bbox);
  assert.equal(snap.grid.cells.length, game.grid.cells.length);
  assert.deepEqual(Object.keys(snap.grid.cells[0]).sort(), ['id', 'polygon']);
  assert.equal(snap.grid.baseCellId, game.baseCellId);

  // ownership carries only {id, ownerId, color} — no progress leak
  const own = snap.ownership.find((c) => c.id === '0_0');
  assert.deepEqual(own, { id: '0_0', ownerId: 'A', color: a.color });

  assert.equal(snap.players.length, 1);
  assert.deepEqual(Object.keys(snap.players[0]).sort(), [
    'alive', 'ammo', 'color', 'connected', 'heading',
    'id', 'lat', 'lives', 'lng', 'name', 'shieldActive',
  ].sort());
  assert.equal(snap.players[0].sessionId, undefined);

  assert.equal(snap.maxAmmo, 3);
  assert.equal(snap.ammoRenewalMs, 5000);
  assert.equal(snap.scores.A.squares, 1, 'tally reflects gridStore ownership');
});

test('snapshot ownership reflects live gridStore, not the grid template', async (t) => {
  const { game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  const a = await game.addPlayer('A', 'Alice');
  await game.gridStore.set('2_3', {
    ownerId: 'A',
    color: a.color,
    progress: null,
  });

  const snap = await game.snapshot();
  const owned = snap.ownership.filter((c) => c.ownerId === 'A');
  assert.equal(owned.length, 1);
  assert.equal(owned[0].id, '2_3');
  assert.equal(owned[0].color, a.color);
  const unowned = snap.ownership.find((c) => c.id === '0_0');
  assert.equal(unowned.ownerId, null);
});
