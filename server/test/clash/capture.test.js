import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGame,
  eventsNamed,
  tick,
  placeInCell,
  patchPlayer,
  sleep,
} from './helpers.js';

test('tick accrues capture progress and emits cell-capture-start once', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice');
  await placeInCell(game, 'A', '0_0');
  game.matchActive = true;

  await tick(game, 1000);
  const cell = await game.gridStore.get('0_0');
  assert.ok(cell.progress, 'progress started');
  assert.equal(cell.progress.playerId, 'A');
  assert.ok(cell.progress.elapsedMs >= 1000, `elapsedMs=${cell.progress.elapsedMs}`);
  assert.ok(cell.progress.elapsedMs < 2000, 'bounded by dt + eps');
  assert.equal(cell.ownerId, null);
  assert.equal(eventsNamed(io, 'cell-capture-start').length, 1);

  await tick(game, 500);
  assert.equal(
    eventsNamed(io, 'cell-capture-start').length,
    1,
    'no duplicate start while same claimant',
  );
});

test('ownership flips at CAPTURE_SECONDS; grid-update diff carries cell + recount', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  const a = await game.addPlayer('A', 'Alice');
  await placeInCell(game, 'A', '0_0');
  game.matchActive = true;

  await tick(game, 5100);
  const cell = await game.gridStore.get('0_0');
  assert.equal(cell.ownerId, 'A');
  assert.equal(cell.color, a.color);
  assert.equal(cell.progress, null);

  const updates = eventsNamed(io, 'grid-update');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].payload.cells, [
    { id: '0_0', ownerId: 'A', color: a.color },
  ]);
  const scores = updates[0].payload.scores;
  assert.equal(scores.A.squares, 1);
  assert.equal(scores.A.name, 'Alice');
  assert.equal(scores.A.color, a.color);
});

test('contested cell (two different-color players) accrues no progress', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice'); // red
  await game.addPlayer('B', 'Bob');   // blue
  await placeInCell(game, 'A', '0_0');
  await placeInCell(game, 'B', '0_0');
  game.matchActive = true;

  await tick(game, 5100);
  const cell = await game.gridStore.get('0_0');
  assert.equal(cell.progress, null);
  assert.equal(cell.ownerId, null);
  assert.equal(eventsNamed(io, 'cell-capture-start').length, 0);
  assert.equal(eventsNamed(io, 'grid-update').length, 0);
});

test('same-color co-occupants still capture; claim credited to first occupant', async (t) => {
  const { game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  const a = await game.addPlayer('A', 'Alice');
  await game.addPlayer('B', 'Bob');
  // force B onto A's team color
  await patchPlayer(game, 'B', { color: a.color });
  await placeInCell(game, 'A', '0_0');
  await placeInCell(game, 'B', '0_0');
  game.matchActive = true;

  await tick(game, 5100);
  const cell = await game.gridStore.get('0_0');
  // occupants[0] is the first playerStore entry (insertion order) -> A
  assert.equal(cell.ownerId, 'A');
  assert.equal(cell.progress, null);
});

test('standing in an already-owned cell does not restart capture', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  const a = await game.addPlayer('A', 'Alice');
  await placeInCell(game, 'A', '0_0');
  await game.gridStore.set('0_0', {
    ownerId: 'A',
    color: a.color,
    progress: null,
  });
  game.matchActive = true;

  await tick(game, 1000);
  const cell = await game.gridStore.get('0_0');
  assert.equal(cell.progress, null);
  assert.equal(cell.ownerId, 'A');
  assert.equal(eventsNamed(io, 'cell-capture-start').length, 0);
  assert.equal(eventsNamed(io, 'grid-update').length, 0);
});

test('vacating a cell mid-capture clears progress', async (t) => {
  const { game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice');
  await placeInCell(game, 'A', '0_0');
  game.matchActive = true;

  await tick(game, 1000);
  assert.ok((await game.gridStore.get('0_0')).progress, 'progress accrued');

  await placeInCell(game, 'A', '0_1');
  await tick(game, 200);
  const old = await game.gridStore.get('0_0');
  assert.equal(old.progress, null, 'progress cleared on vacate');
});

test('disconnected occupant does not claim', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  const a = await game.addPlayer('A', 'Alice');
  await placeInCell(game, 'A', '0_0');
  game.matchActive = true;

  await patchPlayer(game, 'A', { connected: false });
  await tick(game, 1000);
  let cell = await game.gridStore.get('0_0');
  assert.equal(cell.progress, null, 'all-disconnected cell is skipped');

  // mixed pair: A reconnects, B (same color) stays disconnected -> still
  // captures via the connected first occupant
  await patchPlayer(game, 'A', { connected: true });
  await game.addPlayer('B', 'Bob');
  await patchPlayer(game, 'B', { color: a.color, connected: false });
  await placeInCell(game, 'B', '0_0');
  await tick(game, 5100);
  cell = await game.gridStore.get('0_0');
  assert.equal(cell.ownerId, 'A');
  assert.ok(eventsNamed(io, 'cell-capture-start').length >= 1);
});

test('dead player does not claim cells', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice');
  await placeInCell(game, 'A', '0_0');
  await patchPlayer(game, 'A', { alive: false });
  game.matchActive = true;

  await tick(game, 5100);
  const cell = await game.gridStore.get('0_0');
  assert.equal(cell.progress, null);
  assert.equal(cell.ownerId, null);
  assert.equal(eventsNamed(io, 'cell-capture-start').length, 0);
});

test('no grid-update is emitted while capture is still in progress', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice');
  await placeInCell(game, 'A', '0_0');
  game.matchActive = true;

  await tick(game, 1000);
  await tick(game, 1000);
  assert.ok(eventsNamed(io, 'cell-capture-start').length >= 1);
  assert.ok(eventsNamed(io, 'players-update').length >= 1);
  assert.ok(eventsNamed(io, 'timer').length >= 1);
  assert.equal(eventsNamed(io, 'grid-update').length, 0);
});

test('tick in lobby runs players-update but no capture or timer', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice');
  await placeInCell(game, 'A', '0_0');
  // matchActive stays false (lobby)

  await tick(game, 5100);
  const cell = await game.gridStore.get('0_0');
  assert.equal(cell.progress, null, 'no capture while inactive');
  assert.equal(eventsNamed(io, 'timer').length, 0, 'no timer while inactive');
  assert.ok(eventsNamed(io, 'players-update').length >= 1);
});

test('timer decrements by dt and emits timer each tick while active', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  game.matchActive = true;
  const start = game.remainingSeconds;

  await tick(game, 2000);
  const drop = start - game.remainingSeconds;
  assert.ok(drop >= 1.9 && drop <= 2.5, `drop=${drop}`);
  const timers = eventsNamed(io, 'timer');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].payload.remainingSeconds, game.remainingSeconds);
});

test('timer reaching zero ends the match', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  game.matchActive = true;
  game.remainingSeconds = 0.05;

  await tick(game, 1000);
  // endMatch is invoked un-awaited inside tick(); let it drain.
  await sleep(25);
  assert.equal(game.matchActive, false);
  assert.equal(game.status, 'ended');
  assert.equal(eventsNamed(io, 'match-end').length, 1);

  io._events.length = 0;
  await game.tick();
  assert.equal(io._events.length, 0, 'tick early-returns once ended');
});

test('tick emits players-update with the public player shape', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice', 'sess-1');
  await tick(game, 200);
  const upd = eventsNamed(io, 'players-update');
  assert.equal(upd.length, 1);
  const p = upd[0].payload.players[0];
  assert.deepEqual(Object.keys(p).sort(), [
    'alive', 'ammo', 'color', 'connected', 'heading',
    'id', 'lat', 'lives', 'lng', 'name', 'shieldActive',
  ].sort());
  assert.equal(p.sessionId, undefined);
  assert.equal(p.shieldUntil, undefined);
  assert.equal(p.lastSeen, undefined);
});

test('re-entering a cell restarts capture from zero', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice');
  await placeInCell(game, 'A', '0_0');
  game.matchActive = true;

  await tick(game, 1000); // ~1s progress in 0_0
  await placeInCell(game, 'A', '0_1');
  await tick(game, 100);
  assert.equal((await game.gridStore.get('0_0')).progress, null);

  await placeInCell(game, 'A', '0_0');
  await tick(game, 200);
  const cell = await game.gridStore.get('0_0');
  assert.ok(cell.progress, 'capture restarted');
  assert.ok(cell.progress.elapsedMs < 1500, 'restarted near zero');
  const starts = eventsNamed(io, 'cell-capture-start')
    .filter((e) => e.payload.cellId === '0_0');
  assert.equal(starts.length, 2, 'second capture-start for re-entry');
});

test('cells owned by a removed player do not count toward any score', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  const a = await game.addPlayer('A', 'Alice');
  await game.addPlayer('B', 'Bob');
  await game.gridStore.set('0_0', {
    ownerId: 'A',
    color: a.color,
    progress: null,
  });
  await game.removePlayer('A');
  await placeInCell(game, 'B', '0_1');
  game.matchActive = true;

  await tick(game, 5100);
  const updates = eventsNamed(io, 'grid-update');
  assert.equal(updates.length, 1);
  const scores = updates[0].payload.scores;
  assert.equal(scores.A, undefined, 'removed player omitted from tally');
  assert.equal(scores.B.squares, 1);
});
