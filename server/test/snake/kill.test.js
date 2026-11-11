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

test('clash kill resets the victim and credits the killer', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({
    io,
    roomId: 'kill-test',
    centerLat: 51.5,
    centerLng: -0.12,
    arenaSideMeters: 200,
    foodRespawnIntervalMs: 999_999,
  });
  t.after(() => game.endMatch());

  await game.addPlayer('p1', 'Alice');
  await game.addPlayer('p2', 'Bob');
  game.startMatch();

  // Give the victim something to lose.
  const tail = [{ lat: 51.5, lng: -0.12 }, { lat: 51.5001, lng: -0.12 }];
  await game.updateLocation('p2', 51.5, -0.12, 0, tail, 7);

  await game._killPlayer('p2', 'p1');

  const victim = await game.playerStore.get('p2');
  assert.equal(victim.score, 0, 'victim score reset');
  assert.deepEqual(victim.tailPoints, [], 'victim tail cleared');

  const killer = await game.playerStore.get('p1');
  assert.equal(killer.kills, 1, 'killer kill count incremented');
  assert.equal(killer.score, 5, 'killer awarded kill bonus');

  const hit = io._events.find((e) => e.event === 'snake-hit');
  assert.ok(hit, 'snake-hit broadcast');
  assert.deepEqual(hit.payload, { victimId: 'p2', killerId: 'p1' });

  const reset = io._events.find((e) => e.event === 'snake-reset');
  assert.ok(reset, 'victim told to reset its local snake');
});
