import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';
import { MAX_TAIL_SEGMENTS } from '../../src/snake/constants.js';

// Tails are client-authoritative: the server stores whatever `tailPoints`
// the client reports via location-update and relays them verbatim. The old
// server-side append/trim model (score * TAIL_METERS_PER_SCORE cap,
// MAX_TAIL_SEGMENTS enforcement) is gone — these tests pin that contract.

function makeIo() {
  return {
    to: () => ({ emit: () => {} }),
    emit: () => {},
  };
}

function makeGame(t, roomId) {
  const game = new SnakeGameState({
    io: makeIo(),
    roomId,
    centerLat: 51.5,
    centerLng: -0.12,
  });
  t.after(() => game.endMatch());
  return game;
}

test('server stores client tail verbatim — no score-based trimming', async (t) => {
  const game = makeGame(t, 'trim-verbatim');
  await game.addPlayer('p1', 'Alice');
  game.startMatch();

  // Client reports a 40-segment tail while its score is 0.
  const tail = Array.from({ length: 40 }, (_, i) => ({
    lat: 51.5 + i * 0.0001,
    lng: -0.12,
  }));
  await game.updateLocation('p1', 51.5, -0.12, 0, tail, 0);

  const p = await game.playerStore.get('p1');
  assert.deepEqual(
    p.tailPoints,
    tail,
    'tailPoints must be stored verbatim regardless of score',
  );
});

test('server does not enforce MAX_TAIL_SEGMENTS on client tails', async (t) => {
  const game = makeGame(t, 'trim-no-cap');
  await game.addPlayer('p1', 'Alice');
  game.startMatch();

  const oversized = Array.from({ length: MAX_TAIL_SEGMENTS + 50 }, (_, i) => ({
    lat: 51.5 + i * 0.00001,
    lng: -0.12,
  }));
  await game.updateLocation('p1', 51.5, -0.12, 0, oversized, 999);

  const p = await game.playerStore.get('p1');
  assert.equal(
    p.tailPoints.length,
    MAX_TAIL_SEGMENTS + 50,
    'cap enforcement (if any) is the client’s job — server relays verbatim',
  );
});
