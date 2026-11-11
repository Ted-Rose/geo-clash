import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';

function makeIo() {
  const events = [];
  return {
    _events: events,
    to: (id) => ({ emit: (e, p) => events.push({ target: id, event: e, payload: p }) }),
    emit: (e, p) => events.push({ event: e, payload: p }),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('food respawn interval: depleted food is replenished; food-update only when count changes', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({
    io,
    roomId: 'food-respawn',
    centerLat: 51.5,
    centerLng: -0.12,
    foodCountTarget: 3,
    foodRespawnIntervalMs: 20, // short real interval — the only timing test
  });
  t.after(() => game.endMatch());
  game.startMatch();
  // Keep the tick interval inert — only the food interval is under test.
  if (game._tickHandle) { clearInterval(game._tickHandle); game._tickHandle = null; }

  game._foods = []; // simulate everything being eaten

  await sleep(120);
  assert.equal(game._foods.length, 3, 'food replenished back to target');
  const updatesAfterReplenish = io._events.filter((e) => e.event === 'food-update').length;
  assert.ok(updatesAfterReplenish >= 1, 'food-update emitted when count changed');

  // With food already at target, no further food-update events fire.
  await sleep(80);
  assert.equal(
    io._events.filter((e) => e.event === 'food-update').length,
    updatesAfterReplenish,
    'no food-update emitted while the count is unchanged',
  );
});
