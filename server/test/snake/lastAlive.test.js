import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';

// NOTE: the old "last player alive ends the match" rule no longer exists —
// _killPlayer respawns the victim in place (alive stays true) and _tick only
// ends the match on the time limit. These tests pin the CURRENT end-of-match
// behavior so the suite no longer misleads (and always cleans up its tick
// interval via t.after so `node --test` cannot hang).

function makeIo() {
  const events = [];
  return {
    _events: events,
    to: (id) => ({ emit: (e, p) => events.push({ target: id, event: e, payload: p }) }),
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
  if (game._tickHandle) { clearInterval(game._tickHandle); game._tickHandle = null; }
  if (game._foodInterval) { clearInterval(game._foodInterval); game._foodInterval = null; }
}

test('killing a player does NOT end the match (no last-alive rule)', async (t) => {
  const { io, game } = makeGame(t, { roomId: 'no-last-alive' });
  game._foods = [];
  await game.addPlayer('p1', 'Alice');
  await game.addPlayer('p2', 'Bob');
  game.startMatch();
  freezeTimers(game);

  await game._killPlayer('p2', 'p1');
  await game._tick();

  assert.equal(
    io._events.filter((e) => e.event === 'match-end').length,
    0,
    'match-end must not fire just because a player was killed',
  );
  assert.equal(game.matchActive, true);
  assert.equal(game.status, 'active');
  // The victim is respawned in place, not eliminated.
  const p2 = await game.playerStore.get('p2');
  assert.equal(p2.alive, true);
});

test('_tick ends the match when the time limit expires', async (t) => {
  const { io, game } = makeGame(t, { roomId: 'time-limit-end', timeLimitMs: 1000 });
  game._foods = [];
  await game.addPlayer('p1', 'Alice');
  game.startMatch();
  freezeTimers(game);

  // Pretend the match started 2 s ago (limit is 1 s).
  game._matchStartAt = Date.now() - 2000;
  await game._tick();

  const matchEnd = io._events.find((e) => e.event === 'match-end');
  assert.ok(matchEnd, 'match-end event should be emitted on time-limit expiry');
  assert.equal(game.status, 'ended');
  assert.equal(game.matchActive, false);
});

test('_tick is a no-op after the match has ended', async (t) => {
  const { io, game } = makeGame(t, { roomId: 'tick-after-end' });
  game._foods = [];
  await game.addPlayer('p1', 'Alice');
  game.startMatch();
  freezeTimers(game);
  await game.endMatch();

  io._events.length = 0;
  await game._tick();

  assert.equal(
    io._events.length,
    0,
    'no events should be emitted by _tick once status is ended',
  );
});
