import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';

function makeIo() {
  const events = [];
  return {
    _events: events,
    to: () => ({ emit: (e, p) => events.push({ event: e, payload: p }) }),
    emit: (e, p) => events.push({ event: e, payload: p }),
  };
}

test('last player alive triggers match-end', async () => {
  const io = makeIo();
  const game = new SnakeGameState({
    io,
    roomId: 'last-alive-test',
    centerLat: 51.5,
    centerLng: -0.12,
    arenaSideMeters: 200,
    foodRespawnIntervalMs: 999_999,
  });

  await game.addPlayer('p1', 'Alice');
  await game.addPlayer('p2', 'Bob');

  game._bbox = {
    south: 51.499, north: 51.501, west: -0.121, east: -0.119,
  };
  game._foods = [];
  game.startMatch();

  // Kill p2 directly so p1 is the last snake standing
  await game._killPlayer('p2', 'p1');

  // Run tick — should detect 1 alive out of 2 total and call endMatch
  await game._tick();

  const matchEnd = io._events.find((e) => e.event === 'match-end');
  assert.ok(matchEnd, 'match-end event should be emitted');
  assert.equal(game.status, 'ended', 'game status should be ended');
});
