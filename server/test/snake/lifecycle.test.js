import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';
import { leaderboardStore } from '../../src/shared/memoryStore.js';

function makeIo() {
  const events = [];
  return {
    _events: events,
    to: (id) => ({
      emit: (e, p) => events.push({ target: id, event: e, payload: p }),
    }),
    emit: (e, p) => events.push({ event: e, payload: p }),
  };
}

function makeGame(t, opts) {
  const io = makeIo();
  const game = new SnakeGameState({
    io,
    centerLat: 51.5,
    centerLng: -0.12,
    arenaSideMeters: 200,
    foodRespawnIntervalMs: 999_999,
    ...opts,
  });
  t.after(() => game.endMatch());
  return { io, game };
}

function freezeTimers(game) {
  if (game._tickHandle) {
    clearInterval(game._tickHandle);
    game._tickHandle = null;
  }
  if (game._foodInterval) {
    clearInterval(game._foodInterval);
    game._foodInterval = null;
  }
}

// endMatch() archives into the module-level leaderboardStore singleton —
// stub `archive` per test (and restore) so assertions stay isolated.
function stubArchive(t) {
  const calls = [];
  const orig = leaderboardStore.archive;
  leaderboardStore.archive = async (entry) => {
    calls.push(entry);
    return entry;
  };
  t.after(() => { leaderboardStore.archive = orig; });
  t.after(() => leaderboardStore.clear?.());
  return calls;
}

test('endMatch: archives players, emits sorted match-end', async (t) => {
  const archived = stubArchive(t);
  const { io, game } = makeGame(t, { roomId: 'end-archive' });
  await game.addPlayer('p1', 'Alice');
  await game.addPlayer('p2', 'Bob');
  const p1 = await game.playerStore.get('p1');
  p1.score = 10;
  await game.playerStore.set('p1', p1);
  const p2 = await game.playerStore.get('p2');
  p2.score = 3;
  await game.playerStore.set('p2', p2);
  game.startMatch();
  freezeTimers(game);

  await game.endMatch();

  assert.equal(archived.length, 2, 'one archive call per player');
  for (const entry of archived) {
    assert.equal(entry.gameType, 'snake');
    assert.equal(entry.metric, 'kills');
    assert.ok(typeof entry.matchId === 'string' && entry.matchId.length > 0);
    assert.ok(typeof entry.finishedAt === 'number');
  }
  assert.deepEqual(archived.map((e) => e.playerId).sort(), ['p1', 'p2']);

  const matchEnd = io._events.find((e) => e.event === 'match-end');
  assert.ok(matchEnd, 'match-end emitted');
  assert.deepEqual(
    matchEnd.payload.leaderboard.map((e) => e.id),
    ['p1', 'p2'],
    'leaderboard sorted by score desc',
  );
  assert.equal(matchEnd.payload.leaderboard[0].score, 10);
  // `scores` is computed from the pre-purge player list, so it carries
  // the real final tally for every player.
  assert.deepEqual(matchEnd.payload.scores, {
    p1: { name: 'Alice', color: p1.color, score: 10, kills: 0 },
    p2: { name: 'Bob', color: p2.color, score: 3, kills: 0 },
  });
});

test('endMatch: purges, ends, clears intervals, calls _onEnd', async (t) => {
  stubArchive(t);
  let onEndCalls = 0;
  const { game } = makeGame(t, {
    roomId: 'end-teardown',
    onEnd: () => { onEndCalls += 1; },
  });
  await game.addPlayer('p1', 'Alice');
  game.startMatch();
  assert.ok(game._tickHandle, 'tick interval running');
  assert.ok(game._foodInterval, 'food interval running');

  await game.endMatch();

  assert.equal(game.status, 'ended');
  assert.equal(game.matchActive, false);
  assert.equal(game._tickHandle, null, 'tick interval cleared');
  assert.equal(game._foodInterval, null, 'food interval cleared');
  assert.equal((await game.playerStore.all()).length, 0, 'playerStore purged');
  assert.equal(onEndCalls, 1, '_onEnd callback fired once');
});

test('endMatch: second call is a no-op (idempotent)', async (t) => {
  const archived = stubArchive(t);
  const { io, game } = makeGame(t, { roomId: 'end-twice' });
  await game.addPlayer('p1', 'Alice');
  game.startMatch();
  freezeTimers(game);

  await game.endMatch();
  await game.endMatch();

  assert.equal(archived.length, 1, 'archive ran once per player, not twice');
  assert.equal(
    io._events.filter((e) => e.event === 'match-end').length,
    1,
    'match-end emitted exactly once',
  );
});

test('startMatch: emits match-start with the full payload', async (t) => {
  stubArchive(t);
  const { io, game } = makeGame(t, {
    roomId: 'start-payload', timeLimitMs: 60_000,
  });
  await game.addPlayer('p1', 'Alice');

  const before = Date.now();
  game.startMatch();

  const evt = io._events.find((e) => e.event === 'match-start');
  assert.ok(evt, 'match-start emitted');
  const { bbox, foods, timeLimitMs, matchStartAt } = evt.payload;
  assert.ok(bbox && bbox.south < bbox.north && bbox.west < bbox.east);
  assert.ok(Array.isArray(foods) && foods.length === game._foodCountTarget);
  assert.equal(timeLimitMs, 60_000);
  assert.ok(matchStartAt >= before && matchStartAt <= Date.now());
  assert.equal(game.status, 'active');
  assert.equal(game.matchActive, true);
});

test('startMatch: second call is a no-op', async (t) => {
  stubArchive(t);
  const { io, game } = makeGame(t, { roomId: 'start-twice' });
  game.startMatch();
  const tickHandle = game._tickHandle;
  game.startMatch();

  assert.equal(
    io._events.filter((e) => e.event === 'match-start').length,
    1,
    'match-start emitted once',
  );
  assert.equal(game._tickHandle, tickHandle, 'tick interval not replaced');
});

test('startMatch: after endMatch it does not restart', async (t) => {
  stubArchive(t);
  const { io, game } = makeGame(t, { roomId: 'no-restart' });
  game.startMatch();
  await game.endMatch();

  game.startMatch();

  assert.equal(game.matchActive, false);
  assert.equal(game.status, 'ended');
  assert.equal(
    io._events.filter((e) => e.event === 'match-start').length,
    1,
    'no second match-start after end',
  );
});

test('_tick: emits snake-update with players and scores', async (t) => {
  stubArchive(t);
  const { io, game } = makeGame(t, { roomId: 'tick-update' });
  await game.addPlayer('p1', 'Alice');
  game.startMatch();
  freezeTimers(game);
  io._events.length = 0;

  await game._tick();

  const update = io._events.find((e) => e.event === 'snake-update');
  assert.ok(update, 'snake-update emitted');
  const [pl] = update.payload.players;
  assert.deepEqual(
    Object.keys(pl).sort(),
    [
      'alive', 'color', 'connected', 'heading', 'id', 'kills',
      'lat', 'lng', 'name', 'score', 'spawnedAt', 'tailPoints',
    ],
    'public player shape only — no private fields like lastSeen',
  );
  assert.equal(pl.id, 'p1');
  assert.deepEqual(update.payload.scores, {
    p1: { name: 'Alice', color: pl.color, score: 0, kills: 0 },
  });
});
