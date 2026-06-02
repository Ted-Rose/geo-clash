import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';
import { MIN_MOVE_M, TAIL_METERS_PER_SCORE } from '../../src/snake/constants.js';
import { metersToDegLat, distanceMeters } from '../../src/shared/gridUtils.js';

function makeIo() {
  return {
    to: () => ({ emit: () => {} }),
    emit: () => {},
  };
}

test('tail path length is capped at score * TAIL_METERS_PER_SCORE', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({ io, roomId: 'trim-test' });
  t.after(() => game.endMatch());
  await game.addPlayer('p1', 'Alice');
  game.startMatch();

  // Give the player a score of 4 → max tail = 4 * 5 = 20 m
  const p0 = await game.playerStore.get('p1');
  p0.score = 4;
  await game.playerStore.set('p1', p0);

  // Walk 60 m (well past the 20 m cap)
  const stepLat = metersToDegLat(MIN_MOVE_M * 2);
  let lat = 51.5;
  for (let i = 0; i < 40; i++) {
    lat += stepLat;
    await game.updateLocation('p1', lat, -0.12, 0);
  }

  const p = await game.playerStore.get('p1');
  const pts = p.tailPoints;
  let totalLen = 0;
  for (let i = 1; i < pts.length; i++) {
    totalLen += distanceMeters(pts[i - 1], pts[i]);
  }
  const maxLen = 4 * TAIL_METERS_PER_SCORE;
  assert.ok(
    totalLen <= maxLen + 0.1,
    `tail path ${totalLen.toFixed(2)}m exceeds cap ${maxLen}m`
  );
});

test('tail stays empty when score is 0', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({ io, roomId: 'trim-score0' });
  t.after(() => game.endMatch());
  await game.addPlayer('p1', 'Alice');
  game.startMatch();

  const stepLat = metersToDegLat(MIN_MOVE_M * 2);
  let lat = 51.5;
  for (let i = 0; i < 10; i++) {
    lat += stepLat;
    await game.updateLocation('p1', lat, -0.12, 0);
  }
  const p = await game.playerStore.get('p1');
  assert.strictEqual(p.tailPoints.length, 0, 'tail must be empty with score 0');
});
