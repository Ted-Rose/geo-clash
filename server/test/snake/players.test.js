import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';
import { COLORS } from '../../src/snake/constants.js';

function makeIo() {
  return {
    to: () => ({ emit: () => {} }),
    emit: () => {},
  };
}

test('constructor: throws without io or roomId', () => {
  assert.throws(() => new SnakeGameState({}), /io required/);
  assert.throws(() => new SnakeGameState({ io: makeIo() }), /roomId required/);
});

test('_spawnPoint: samples fall inside _bbox', async (t) => {
  const game = new SnakeGameState({
    io: makeIo(),
    roomId: 'spawn-bbox',
    centerLat: 51.5,
    centerLng: -0.12,
    arenaSideMeters: 100,
  });
  t.after(() => game.endMatch());

  for (let i = 0; i < 200; i++) {
    const s = game._spawnPoint();
    assert.ok(s.lat >= game._bbox.south && s.lat <= game._bbox.north);
    assert.ok(s.lng >= game._bbox.west && s.lng <= game._bbox.east);
  }
});

test('_spawnPoint: without a bbox falls back to the configured center (or origin)', async (t) => {
  const bare = new SnakeGameState({ io: makeIo(), roomId: 'spawn-bare' });
  t.after(() => bare.endMatch());
  assert.deepEqual(bare._spawnPoint(), { lat: 0, lng: 0 });

  // Only a lat was configured, so no arena was built — spawn = center lng defaults to 0.
  const partial = new SnakeGameState({ io: makeIo(), roomId: 'spawn-partial', centerLat: 51.5 });
  t.after(() => partial.endMatch());
  assert.equal(partial._bbox, null);
  assert.deepEqual(partial._spawnPoint(), { lat: 51.5, lng: 0 });
});

test('addPlayer: initial shape, default name, color rotation wraps', async (t) => {
  const game = new SnakeGameState({
    io: makeIo(),
    roomId: 'add-player',
    centerLat: 51.5,
    centerLng: -0.12,
  });
  t.after(() => game.endMatch());

  const p = await game.addPlayer('abcdef123');
  assert.equal(p.name, 'P-abcd', 'default name derives from socket id');
  assert.equal(p.alive, true);
  assert.equal(p.score, 0);
  assert.equal(p.kills, 0);
  assert.deepEqual(p.tailPoints, []);
  assert.equal(p.heading, 0);
  assert.equal(p.color, COLORS[0]);

  // Fill the palette, then verify it wraps modulo COLORS.length.
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
  for (const id of ids) await game.addPlayer(id, id);
  const wrapped = await game.addPlayer('wrap', 'Wrap');
  assert.equal(wrapped.color, COLORS[0], 'colors wrap around the palette');

  const named = await game.playerStore.get('p1');
  assert.equal(named.name, 'p1', 'explicit name is kept');
});
