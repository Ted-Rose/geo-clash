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

function makeGame(t, opts = {}) {
  const game = new SnakeGameState({
    io: makeIo(),
    roomId: 'update-loc',
    ...opts,
  });
  t.after(() => game.endMatch());
  return game;
}

test('updateLocation: stores client-supplied tailPoints and score verbatim; wrong types ignored', async (t) => {
  const game = makeGame(t, { centerLat: 51.5, centerLng: -0.12 });
  await game.addPlayer('p1', 'Alice');

  const tail = [{ lat: 51.5, lng: -0.12 }, { lat: 51.5001, lng: -0.12 }];
  await game.updateLocation('p1', 51.5, -0.12, 90, tail, 7);

  let p = await game.playerStore.get('p1');
  assert.deepEqual(p.tailPoints, tail, 'tailPoints stored verbatim');
  assert.equal(p.score, 7);
  assert.equal(p.heading, 90);
  const seen1 = p.lastSeen;

  // Omit tailPoints/score/heading → previous values retained.
  await game.updateLocation('p1', 51.5001, -0.12);
  p = await game.playerStore.get('p1');
  assert.deepEqual(p.tailPoints, tail, 'omitted tailPoints retained');
  assert.equal(p.score, 7, 'omitted score retained');
  assert.equal(p.heading, 90, 'omitted heading retained');
  assert.equal(p.lat, 51.5001);
  assert.ok(p.lastSeen >= seen1, 'lastSeen updated on every call');

  // Wrong types are ignored, good values still applied.
  await game.updateLocation('p1', 51.5002, -0.12, 'north', 'not-an-array', 'lots');
  p = await game.playerStore.get('p1');
  assert.deepEqual(p.tailPoints, tail, 'non-array tailPoints ignored');
  assert.equal(p.score, 7, 'non-number score ignored');
  assert.equal(p.heading, 90, 'non-number heading ignored');
  assert.equal(p.lat, 51.5002);
});

test('updateLocation: unknown player id → no-op, no throw', async (t) => {
  const game = makeGame(t, { centerLat: 51.5, centerLng: -0.12 });
  await game.updateLocation('ghost', 51.5, -0.12, 0, [], 5);
  assert.equal(await game.playerStore.get('ghost'), undefined);
  assert.equal((await game.playerStore.all()).length, 0);
});

test('updateLocation: first update lazily initializes the arena when built without a center', async (t) => {
  const game = makeGame(t); // no centerLat/centerLng
  assert.equal(game._bbox, null);
  await game.addPlayer('p1', 'Alice');

  await game.updateLocation('p1', 51.5, -0.12, 0);

  assert.ok(game._bbox, 'arena initialized on first location update');
  assert.ok(game._bbox.south <= 51.5 && game._bbox.north >= 51.5);
  assert.ok(game._bbox.west <= -0.12 && game._bbox.east >= -0.12);
  assert.equal(
    game._foods.length,
    game._foodCountTarget,
    'foods populated to target on lazy init',
  );
});
