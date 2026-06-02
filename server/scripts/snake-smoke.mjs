#!/usr/bin/env node
// Quick smoke test for the snake server-side state machine.
// Run: node server/scripts/snake-smoke.mjs

import assert from 'node:assert/strict';
import { SnakeGameState } from '../src/snake/gameState.js';
import { metersToDegLat } from '../src/shared/gridUtils.js';
import { MIN_MOVE_M, EAT_RADIUS_M, FOOD_COUNT_TARGET } from '../src/snake/constants.js';

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) {
    console.log(`  ✔ ${label}`);
    passed++;
  } else {
    console.error(`  ✖ ${label}`);
    failed++;
  }
}

function makeIo() {
  const events = [];
  return {
    _events: events,
    to: () => ({ emit: (e, p) => events.push({ event: e, payload: p }) }),
    emit: (e, p) => events.push({ event: e, payload: p }),
  };
}

console.log('\nGeo Snake smoke test\n');

// 1. Create game + player
{
  const io = makeIo();
  const game = new SnakeGameState({ io, roomId: 'smoke1' });
  const p = await game.addPlayer('p1', 'Alice');
  ok('addPlayer returns player with id', p.id === 'p1');
  ok('player starts alive', p.alive === true);
  ok('player starts with empty tail', Array.isArray(p.tailPoints) && p.tailPoints.length === 0);
  await game.endMatch();
}

// 2. Tail grows on movement
{
  const io = makeIo();
  const game = new SnakeGameState({
    io,
    roomId: 'smoke2',
    centerLat: 51.5,
    centerLng: -0.12,
  });
  await game.addPlayer('p1', 'Alice');
  game._bbox = { south: 51.499, north: 51.501, west: -0.121, east: -0.119 };
  game._foods = [];
  game.startMatch();
  const step = metersToDegLat(MIN_MOVE_M * 2);
  for (let i = 0; i < 5; i++) {
    await game.updateLocation('p1', 51.5 + step * (i + 1), -0.12, 0);
  }
  const p = await game.playerStore.get('p1');
  ok('tail grows with movement', p.tailPoints.length > 0);
  await game.endMatch();
}

// 3. Food is replenished after eating
{
  const io = makeIo();
  const game = new SnakeGameState({
    io,
    roomId: 'smoke3',
    centerLat: 51.5,
    centerLng: -0.12,
  });
  await game.addPlayer('p1', 'Alice');
  game._bbox = { south: 51.499, north: 51.501, west: -0.121, east: -0.119 };
  game._foods = [{ id: 'f1', lat: 51.5, lng: -0.12 }];
  game.startMatch();
  await game.updateLocation('p1', 51.5, -0.12, 0);
  await game._tick();
  ok(`food replenished to ${FOOD_COUNT_TARGET}`, game._foods.length === FOOD_COUNT_TARGET);
  const p = await game.playerStore.get('p1');
  ok('player scored after eating', p.score >= 1);
  await game.endMatch();
}

// 4. Snapshot includes expected keys
{
  const io = makeIo();
  const game = new SnakeGameState({ io, roomId: 'smoke4' });
  const snap = await game.snapshot();
  ok('snapshot.gameType === snake', snap.gameType === 'snake');
  ok('snapshot.players is array', Array.isArray(snap.players));
  ok('snapshot.foods is array', Array.isArray(snap.foods));
  await game.endMatch();
}

console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
