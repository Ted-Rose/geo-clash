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

test('player scores when walking over food', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({
    io,
    roomId: 'eat-test',
    centerLat: 51.5,
    centerLng: -0.12,
    arenaSideMeters: 200,
  });
  t.after(() => game.endMatch());
  await game.addPlayer('p1', 'Alice');

  // Initialise arena and place a food item directly on the player
  game._bbox = {
    south: 51.499, north: 51.501, west: -0.121, east: -0.119,
  };
  game._foods = [{ id: 'food1', lat: 51.5, lng: -0.12 }];
  game.startMatch();

  // Walk to the food location
  await game.updateLocation('p1', 51.5, -0.12, 0);

  // Run tick manually
  await game._tick();

  const p = await game.playerStore.get('p1');
  assert.ok(p.score >= 1, `expected score >= 1, got ${p.score}`);

  const ate = io._events.find((e) => e.event === 'snake-ate');
  assert.ok(ate, 'snake-ate event emitted');
  assert.equal(ate.payload.playerId, 'p1');
  assert.equal(ate.payload.foodId, 'food1');
});
