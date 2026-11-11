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

test('player scores when reporting an eaten food item', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({
    io,
    roomId: 'eat-test',
    centerLat: 51.5,
    centerLng: -0.12,
    arenaSideMeters: 200,
    foodRespawnIntervalMs: 999_999,
  });
  t.after(() => game.endMatch());
  await game.addPlayer('p1', 'Alice');

  // Initialise arena and place a food item on the player
  game._bbox = {
    south: 51.499, north: 51.501, west: -0.121, east: -0.119,
  };
  game._foods = [{ id: 'food1', lat: 51.5, lng: -0.12 }];
  game.startMatch();

  // Eating is client-reported via the eat_food event.
  await game.eatFood('p1', 'food1');

  const p = await game.playerStore.get('p1');
  assert.ok(p.score >= 1, `expected score >= 1, got ${p.score}`);
  assert.equal(game._foods.length, 0, 'food removed from live list');

  const ate = io._events.find((e) => e.event === 'snake-ate');
  assert.ok(ate, 'snake-ate event emitted');
  assert.equal(ate.payload.playerId, 'p1');
  assert.equal(ate.payload.foodId, 'food1');
});
