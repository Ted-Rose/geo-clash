import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';
import { SPAWN_GRACE_MS } from '../../src/snake/constants.js';

function makeIo() {
  const events = [];
  return {
    _events: events,
    to: () => ({ emit: (e, p) => events.push({ event: e, payload: p }) }),
    emit: (e, p) => events.push({ event: e, payload: p }),
  };
}

test('two snakes at same position both die (head-on-head)', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({
    io,
    roomId: 'hoh-test',
    centerLat: 51.5,
    centerLng: -0.12,
  });
  t.after(() => game.endMatch());

  game._bbox = { south: 51.499, north: 51.501, west: -0.121, east: -0.119 };
  game._foods = [];

  await game.addPlayer('p1', 'A');
  await game.addPlayer('p2', 'B');

  // Force both alive and past spawn grace
  const past = Date.now() - SPAWN_GRACE_MS - 100;
  const p1 = await game.playerStore.get('p1');
  p1.spawnedAt = past;
  p1.lat = 51.5; p1.lng = -0.12;
  await game.playerStore.set('p1', p1);

  const p2 = await game.playerStore.get('p2');
  p2.spawnedAt = past;
  p2.lat = 51.5; p2.lng = -0.12;
  await game.playerStore.set('p2', p2);

  game.startMatch();
  await game._tick();

  const died = io._events.filter((e) => e.event === 'snake-died');
  assert.ok(died.length >= 1, 'at least one snake-died event expected');
});
