import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGameState } from '../../src/snake/gameState.js';
import { SPAWN_GRACE_MS } from '../../src/snake/constants.js';

function makeIo() {
  const events = [];
  return {
    _events: events,
    to: (id) => ({ emit: (e, p) => events.push({ target: id, event: e, payload: p }) }),
    emit: (e, p) => events.push({ event: e, payload: p }),
  };
}

async function setupCollidingPlayers(game) {
  game._bbox = { south: 51.499, north: 51.501, west: -0.121, east: -0.119 };
  game._foods = [];

  await game.addPlayer('p1', 'A');
  await game.addPlayer('p2', 'B');

  const past = Date.now() - SPAWN_GRACE_MS - 100;
  const p1 = await game.playerStore.get('p1');
  p1.spawnedAt = past;
  p1.lat = 51.5; p1.lng = -0.12;
  await game.playerStore.set('p1', p1);

  const p2 = await game.playerStore.get('p2');
  p2.spawnedAt = past;
  p2.lat = 51.5; p2.lng = -0.12;
  await game.playerStore.set('p2', p2);
}

test('head-on-head: tick emits clash_verify to both players', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({ io, roomId: 'hoh-verify', centerLat: 51.5, centerLng: -0.12 });
  t.after(() => game.endMatch());

  await setupCollidingPlayers(game);
  game.startMatch();
  await game._tick();

  const verifies = io._events.filter((e) => e.event === 'clash_verify');
  assert.ok(verifies.length >= 2, 'clash_verify must be sent to both participants');
});

test('head-on-head: both ack within window → snake-hit fires', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({ io, roomId: 'hoh-ack', centerLat: 51.5, centerLng: -0.12 });
  t.after(() => game.endMatch());

  await setupCollidingPlayers(game);
  game.startMatch();
  await game._tick();

  const verifyEvts = io._events.filter((e) => e.event === 'clash_verify');
  assert.ok(verifyEvts.length >= 1, 'expected at least one clash_verify');

  const clashId = verifyEvts[0].payload.clashId;
  await game.clashAck('p1', clashId);
  await game.clashAck('p2', clashId);

  const hits = io._events.filter((e) => e.event === 'snake-hit');
  assert.ok(hits.length >= 1, 'snake-hit must fire after both ACKs');
});

test('head-on-tail: killer absent (no ack from killer) → no kill', async (t) => {
  const io = makeIo();
  const game = new SnakeGameState({ io, roomId: 'hot-noack', centerLat: 51.5, centerLng: -0.12 });
  t.after(() => game.endMatch());

  game._bbox = { south: 51.499, north: 51.501, west: -0.121, east: -0.119 };
  game._foods = [];

  await game.addPlayer('p1', 'A');
  await game.addPlayer('p2', 'B');

  const past = Date.now() - SPAWN_GRACE_MS - 100;

  // p1 head runs into p2's tail segment at the same position
  const p1 = await game.playerStore.get('p1');
  p1.spawnedAt = past;
  p1.lat = 51.5; p1.lng = -0.12;
  await game.playerStore.set('p1', p1);

  // p2 head is far away but has a tail point exactly where p1's head is
  const p2 = await game.playerStore.get('p2');
  p2.spawnedAt = past;
  p2.lat = 51.5005; p2.lng = -0.12;
  p2.tailPoints = [{ lat: 51.5, lng: -0.12 }];
  await game.playerStore.set('p2', p2);

  game.startMatch();
  await game._tick();

  const verifyEvts = io._events.filter((e) => e.event === 'clash_verify');
  assert.ok(verifyEvts.length >= 1, 'expected clash_verify');

  // Only the victim (p1) acks — killer (p2) is unresponsive
  const clashId = verifyEvts.find((e) => e.target === 'p1')?.payload.clashId;
  assert.ok(clashId, 'expected a clash_verify targeted at p1');
  await game.clashAck('p1', clashId);

  const hits = io._events.filter((e) => e.event === 'snake-hit');
  assert.strictEqual(hits.length, 0, 'snake-hit must NOT fire when killer did not ACK');
});
