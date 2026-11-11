import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, eventsNamed, sleep } from './helpers.js';
import { GameState } from '../../src/clash/gameState.js';
import { makeIoStub } from './helpers.js';

test('startMatch emits match-start once and is idempotent', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);

  game.startMatch();
  game.startMatch(); // second call is a no-op
  const starts = eventsNamed(io, 'match-start');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].payload.remainingSeconds, game.remainingSeconds);
  assert.equal(game.status, 'active');
  assert.equal(game.matchActive, true);
  assert.ok(game._tickHandle, 'tick interval running');
});

test('startMatch is rejected after endMatch', async (t) => {
  const { io, game } = makeGame(t);
  await game.endMatch();
  game.startMatch();
  assert.equal(game.status, 'ended');
  assert.equal(game.matchActive, false);
  assert.equal(eventsNamed(io, 'match-start').length, 0);
  assert.equal(game._tickHandle, null, 'no new interval');
});

test('endMatch is idempotent', async (t) => {
  const io = makeIoStub();
  let ends = 0;
  const game = new GameState({
    io,
    roomId: 'clash-lifecycle-idem',
    onEnd: () => { ends += 1; },
  });
  t.after(() => game.endMatch());

  await game.endMatch();
  await game.endMatch();
  assert.equal(eventsNamed(io, 'match-end').length, 1);
  assert.equal(ends, 1, '_onEnd invoked once');
  assert.equal(game.status, 'ended');
});

test('endMatch clears pending projectile and ammo timers', async (t) => {
  const { io, game } = makeGame(t, { maxAmmo: 2, ammoRenewalMs: 500 });
  await game.addPlayer('A', 'Alice');
  await game.updateLocation('A', 51.5, -0.12, 0);
  // ~1.1m flight -> ~220ms real resolution timer, plus an ammo recharge
  await game.attack('A', { target: { lat: 51.50001, lng: -0.12 } });
  assert.ok(game._projectileTimers.size >= 1);
  assert.ok(game._ammoTimers.size >= 1);

  await game.endMatch();
  assert.equal(game._projectileTimers.size, 0);
  assert.equal(game._ammoTimers.size, 0);

  await sleep(400); // past what tArrival would have been
  assert.equal(
    eventsNamed(io, 'projectile-resolved').length,
    0,
    'cleared timer cannot resolve',
  );
});

test('match-end payload has scores + leaderboard sorted desc by squares', async (t) => {
  const { io, game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  const a = await game.addPlayer('A', 'Alice');
  const b = await game.addPlayer('B', 'Bob');
  // arrange ownership directly; deliberately run NO tick/snapshot so this
  // pins that endMatch recounts scores itself rather than reading stale
  // caches (regression: scores used to be {} here)
  await game.gridStore.set('0_0', { ownerId: 'A', color: a.color, progress: null });
  await game.gridStore.set('0_1', { ownerId: 'A', color: a.color, progress: null });
  await game.gridStore.set('1_0', { ownerId: 'B', color: b.color, progress: null });

  await game.endMatch();
  const end = eventsNamed(io, 'match-end');
  assert.equal(end.length, 1);
  const { scores, leaderboard } = end[0].payload;
  assert.equal(scores.A.squares, 2);
  assert.equal(scores.B.squares, 1);
  assert.equal(leaderboard.length, 2);
  assert.equal(leaderboard[0].id, 'A');
  assert.equal(leaderboard[0].squares, 2);
  assert.equal(leaderboard[1].id, 'B');
  assert.equal(leaderboard[1].squares, 1);
});

test('endMatch purges player/grid/projectile stores', async (t) => {
  const { game } = makeGame(t);
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice');
  await game.updateLocation('A', 51.5, -0.12, 0);
  await game.attack('A', { target: { lat: 51.50005, lng: -0.12 } });

  await game.endMatch();
  assert.equal((await game.playerStore.all()).length, 0);
  assert.equal((await game.gridStore.all()).length, 0);
  assert.equal((await game.projectileStore.all()).length, 0);
});
