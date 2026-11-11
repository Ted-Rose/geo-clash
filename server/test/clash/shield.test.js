import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGame,
  eventsNamed,
  patchPlayer,
  tick,
} from './helpers.js';

test('activateShield sets state and emits player-shield', async (t) => {
  const { io, game } = makeGame(t);
  await game.addPlayer('A', 'Alice');

  const before = Date.now();
  await game.activateShield('A');
  const p = await game.playerStore.get('A');
  assert.equal(p.shieldActive, true);
  assert.ok(p.shieldUntil >= before + 4000, 'shieldUntil ~5s out');
  const ev = eventsNamed(io, 'player-shield');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].payload, { id: 'A', until: p.shieldUntil });
});

test('shield expires on the next tick -> player-shield-end', async (t) => {
  const { io, game } = makeGame(t);
  await game.addPlayer('A', 'Alice');
  await patchPlayer(game, 'A', {
    shieldActive: true,
    shieldUntil: Date.now() - 1, // already expired
  });

  await tick(game, 200);
  const p = await game.playerStore.get('A');
  assert.equal(p.shieldActive, false);
  const ev = eventsNamed(io, 'player-shield-end');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].payload, { id: 'A' });
});

test('activateShield on dead/unknown player is a no-op', async (t) => {
  const { io, game } = makeGame(t);
  await game.addPlayer('A', 'Alice');
  await patchPlayer(game, 'A', { alive: false });

  await game.activateShield('A');
  await game.activateShield('ZZ');
  assert.equal(eventsNamed(io, 'player-shield').length, 0);
  const p = await game.playerStore.get('A');
  assert.equal(p.shieldActive, false);
});
