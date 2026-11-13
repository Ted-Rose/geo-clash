import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGame,
  eventsNamed,
  cellCenter,
  patchPlayer,
  placeInCell,
} from './helpers.js';
import { bboxAround } from '../../src/shared/gridUtils.js';

test('addPlayer spawns at base center with default state', async (t) => {
  const { game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  const p = await game.addPlayer('A', 'Alice');
  const base = cellCenter(game.grid, game.baseCellId);
  assert.equal(p.lat, base.lat);
  assert.equal(p.lng, base.lng);
  assert.equal(p.lives, 3);
  assert.equal(p.alive, true);
  assert.equal(p.connected, true);
  assert.equal(p.ammo, null, 'no ammo rules by default');
  assert.equal(p.color, '#ef4444', 'first COLORS slot');
});

test(
  'addPlayer before grid init spawns at {0,0} and defaults the name',
  async (t) => {
  const { game } = makeGame(t);
  const p1 = await game.addPlayer('abcdef-socket');
  assert.equal(p1.lat, 0);
  assert.equal(p1.lng, 0);
  assert.equal(p1.name, 'P-abcd');
  const p2 = await game.addPlayer('B');
  assert.equal(p2.color, '#3b82f6', 'second COLORS slot');
  },
);

test(
  'updateLocation updates position/heading, also for dead players',
  async (t) => {
  const { game } = makeGame(t);
  await game.addPlayer('A', 'Alice');

  const seen0 = (await game.playerStore.get('A')).lastSeen;
  await game.updateLocation('A', 51.5, -0.12, 90);
  let p = await game.playerStore.get('A');
  assert.equal(p.lat, 51.5);
  assert.equal(p.lng, -0.12);
  assert.equal(p.heading, 90);
  assert.ok(p.lastSeen >= seen0);

  await game.updateLocation('A', 51.6, -0.11, 'bad');
  p = await game.playerStore.get('A');
  assert.equal(p.heading, 90, 'non-number heading leaves prior value');

  // Dead players keep reporting position — they need it to walk back
  // to the base cell and respawn.
  await patchPlayer(game, 'A', { alive: false });
  await game.updateLocation('A', 52.0, 0.0, 180);
  p = await game.playerStore.get('A');
  assert.equal(p.lat, 52.0, 'dead player position still updates');
  assert.equal(p.lng, 0.0);
  assert.equal(p.heading, 180);
  },
);

test('updateLocation seeds the grid centered on the first fix', async (t) => {
  const { game } = makeGame(t);
  await game.addPlayer('A', 'Alice');
  assert.equal(game.grid, null);
  await game.updateLocation('A', 51.5, -0.12);
  assert.ok(game.grid, 'grid built on first fix');
  // side = squaresPerSide * cellSize = 10 * 10 = 100m
  assert.deepEqual(game.grid.bbox, bboxAround(51.5, -0.12, 100));
});

test('ensureGridFromPlayer is a no-op once the grid exists', async (t) => {
  const { game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  const bboxBefore = { ...game.grid.bbox };
  await game.gridStore.set('0_0', {
    ownerId: 'sentinel',
    color: '#000',
    progress: null,
  });
  await game.ensureGridFromPlayer(48.85, 2.35); // Paris — far away
  assert.deepEqual(game.grid.bbox, bboxBefore, 'bbox unchanged');
  const cell = await game.gridStore.get('0_0');
  assert.equal(cell.ownerId, 'sentinel', 'gridStore not re-cleared');
});

test('getPlayerBySessionId finds the player and its socketId', async (t) => {
  const { game } = makeGame(t);
  await game.addPlayer('A', 'Alice', 'sess-1');
  const found = await game.getPlayerBySessionId('sess-1');
  assert.equal(found.socketId, 'A');
  assert.equal(found.player.id, 'A');
  assert.equal(await game.getPlayerBySessionId('nope'), null);
  assert.equal(await game.getPlayerBySessionId(undefined), null);
});

test(
  'swapSocketId re-keys the player and remaps grid ownerId + progress',
  async (t) => {
  const { game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  const a = await game.addPlayer('A', 'Alice', 'sess-1');
  await patchPlayer(game, 'A', { connected: false });
  await game.gridStore.set('0_0', {
    ownerId: 'A',
    color: a.color,
    progress: null,
  });
  await game.gridStore.set('0_1', {
    ownerId: null,
    color: null,
    progress: { playerId: 'A', color: a.color, elapsedMs: 500 },
  });

  await game.swapSocketId('A', 'A2');
  const p = await game.playerStore.get('A2');
  assert.ok(p, 'player re-keyed to new socket id');
  assert.equal(p.id, 'A2');
  assert.equal(p.connected, true);
  assert.equal(await game.playerStore.get('A'), undefined, 'old key gone');
  assert.equal((await game.gridStore.get('0_0')).ownerId, 'A2');
  assert.equal((await game.gridStore.get('0_1')).progress.playerId, 'A2');
  },
);

test('swapSocketId on unknown old id is a no-op', async (t) => {
  const { game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice');
  await game.swapSocketId('ghost', 'B'); // must not throw
  const players = await game.playerStore.all();
  assert.equal(players.length, 1);
  assert.equal(players[0][0], 'A');
});

test(
  'removePlayer deletes the player and clears their in-progress ' +
    'claim but keeps owned cells',
  async (t) => {
  const { game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  const a = await game.addPlayer('A', 'Alice');
  await game.gridStore.set('0_0', {
    ownerId: 'A',
    color: a.color,
    progress: null,
  });
  await game.gridStore.set('0_1', {
    ownerId: null,
    color: null,
    progress: { playerId: 'A', color: a.color, elapsedMs: 500 },
  });

  await game.removePlayer('A');
  assert.equal(await game.playerStore.get('A'), undefined);
  assert.equal((await game.gridStore.get('0_1')).progress, null);
  // documents current behavior: owned cells stay owned by the departed id
  assert.equal((await game.gridStore.get('0_0')).ownerId, 'A');
  },
);

test(
  'respawn at the base cell resets lives/alive/shield and emits ' +
    'player-respawn',
  async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice'); // already at base center
  await patchPlayer(game, 'A', {
    lives: 0,
    alive: false,
    shieldActive: true,
    shieldUntil: Date.now() + 5000,
  });

  await game.respawn('A');
  const p = await game.playerStore.get('A');
  assert.equal(p.lives, 3);
  assert.equal(p.alive, true);
  assert.equal(p.shieldActive, false);
  const ev = eventsNamed(io, 'player-respawn');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].payload, { id: 'A', lives: 3 });
  },
);

test('dead player walks back to base and respawns successfully', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice');
  await placeInCell(game, 'A', '0_0'); // away from base
  await patchPlayer(game, 'A', { lives: 0, alive: false });

  const base = cellCenter(game.grid, game.baseCellId);
  await game.updateLocation('A', base.lat, base.lng);

  await game.respawn('A');
  const p = await game.playerStore.get('A');
  assert.equal(p.alive, true);
  assert.equal(p.lives, 3);
  assert.equal(eventsNamed(io, 'player-respawn').length, 1);
  assert.equal(eventsNamed(io, 'respawn-denied').length, 0);
});

test('respawn outside the base cell emits respawn-denied', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice');
  const c = cellCenter(game.grid, '0_0'); // non-base cell
  await game.updateLocation('A', c.lat, c.lng);
  await patchPlayer(game, 'A', { lives: 0, alive: false });

  await game.respawn('A');
  const ev = eventsNamed(io, 'respawn-denied');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].payload, { id: 'A', reason: 'not-at-base' });
  const p = await game.playerStore.get('A');
  assert.equal(p.lives, 0, 'unchanged');
  assert.equal(p.alive, false, 'unchanged');
});

test('respawn no-ops for unknown player or uninitialized grid', async (t) => {
  const { io, game } = makeGame(t);
  // no initGrid, but player exists
  await game.addPlayer('A', 'Alice');
  await game.respawn('A');
  await game.respawn('ghost');
  assert.equal(eventsNamed(io, 'player-respawn').length, 0);
  assert.equal(eventsNamed(io, 'respawn-denied').length, 0);
});

test('respawn while already alive is a silent no-op', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice'); // at base center, alive
  await patchPlayer(game, 'A', { lives: 1 });

  await game.respawn('A');
  const p = await game.playerStore.get('A');
  assert.equal(p.lives, 1, 'lives unchanged');
  assert.equal(eventsNamed(io, 'player-respawn').length, 0);
  assert.equal(eventsNamed(io, 'respawn-denied').length, 0);
});
