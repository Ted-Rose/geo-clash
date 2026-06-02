import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';
import { MAX_TAIL_SEGMENTS, MIN_MOVE_M } from '../../src/snake/constants.js';
import { metersToDegLat } from '../../src/shared/gridUtils.js';

function makeIo() {
  return {
    to: () => ({ emit: () => {} }),
    emit: () => {},
  };
}

test('tail is trimmed to MAX_TAIL_SEGMENTS', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({ io, roomId: 'trim-test' });
  t.after(() => game.endMatch());
  await game.addPlayer('p1', 'Alice');
  game.startMatch();

  // Walk far enough to generate many segments
  const stepLat = metersToDegLat(MIN_MOVE_M * 2);
  let lat = 51.5;
  for (let i = 0; i <= MAX_TAIL_SEGMENTS + 10; i++) {
    lat += stepLat;
    await game.updateLocation('p1', lat, -0.12, 0);
  }
  const p = await game.playerStore.get('p1');
  assert.ok(
    p.tailPoints.length <= MAX_TAIL_SEGMENTS,
    `tail ${p.tailPoints.length} exceeds cap ${MAX_TAIL_SEGMENTS}`
  );
});
