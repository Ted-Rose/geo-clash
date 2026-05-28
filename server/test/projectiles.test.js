import test from 'node:test';
import assert from 'node:assert/strict';
import {
  spawnProjectile,
  isExpired,
  targetFromHeading,
  PROJECTILE_VMPS,
} from '../src/projectiles.js';
import { distanceMeters } from '../src/gridUtils.js';
import { GameState } from '../src/gameState.js';
import { makeRoomStores } from '../src/memoryStore.js';

function makeIo() {
  const events = [];
  return {
    _events: events,
    to: () => ({ emit: (e, p) => events.push({ event: e, payload: p }) }),
    emit: (e, p) => events.push({ event: e, payload: p }),
  };
}

test('spawnProjectile computes tArrival = tSpawn + dist/vMps*1000', () => {
  const attacker = { id: 'a', lat: 51.5, lng: -0.12 };
  const target = { lat: 51.5, lng: -0.1199 };
  const dist = distanceMeters(attacker, target);
  const t = 1_700_000_000_000;
  const p = spawnProjectile({ attacker, target, vMps: PROJECTILE_VMPS, now: t });
  assert.equal(p.tSpawn, t);
  assert.ok(Math.abs(p.tArrival - (t + (dist / PROJECTILE_VMPS) * 1000)) < 1);
  assert.equal(p.status, 'in-flight');
  assert.equal(p.attackerId, 'a');
});

test('isExpired flips at tArrival', () => {
  const p = { tArrival: 1000 };
  assert.equal(isExpired(p, 999), false);
  assert.equal(isExpired(p, 1000), true);
});

test('targetFromHeading projects roughly correct distance', () => {
  const origin = { lat: 51.5, lng: -0.12 };
  const t = targetFromHeading(origin, 0, 30); // due north 30m
  const d = distanceMeters(origin, t);
  assert.ok(Math.abs(d - 30) < 1, `got ${d}`);
});

test('GameState.attack spawns projectile and resolves to hit', async (t) => {
  const io = makeIo();
  const stores = makeRoomStores('test-room-1');
  const game = new GameState({ io, roomId: 'test-room-1', stores });
  t.after(() => game.endMatch());
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'attacker');
  await game.addPlayer('B', 'victim');
  const startLives = (await game.playerStore.get('B')).lives;
  // Place attacker and victim 5 metres apart.
  await game.updateLocation('A', 51.5, -0.12, 0);
  await game.updateLocation('B', 51.50004, -0.12, 0);
  game.startMatch();
  const before = io._events.length;
  await game.attack('A', { target: { lat: 51.50004, lng: -0.12 } });
  const spawn = io._events.slice(before).find((e) => e.event === 'projectile-spawn');
  assert.ok(spawn, 'projectile-spawn fired');
  // Wait for resolution
  await new Promise((r) => setTimeout(r, spawn.payload.tArrival - Date.now() + 30));
  const resolved = io._events.find((e) => e.event === 'projectile-resolved' && e.payload.id === spawn.payload.id);
  assert.ok(resolved, 'projectile-resolved fired');
  assert.equal(resolved.payload.outcome, 'hit');
  assert.equal(resolved.payload.victimId, 'B');
  // Victim lost a life
  const v = await game.playerStore.get('B');
  assert.equal(v.lives, startLives - 1);
});

test('GameState.attack: shield blocks at tArrival', async (t) => {
  const io = makeIo();
  const stores = makeRoomStores('test-room-2');
  const game = new GameState({ io, roomId: 'test-room-2', stores });
  t.after(() => game.endMatch());
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'attacker');
  await game.addPlayer('B', 'victim');
  await game.updateLocation('A', 51.5, -0.12, 0);
  await game.updateLocation('B', 51.50004, -0.12, 0);
  game.startMatch();
  await game.activateShield('B');
  await game.attack('A', { target: { lat: 51.50004, lng: -0.12 } });
  await new Promise((r) => setTimeout(r, 1500));
  const resolved = io._events.find((e) => e.event === 'projectile-resolved');
  assert.ok(resolved, 'projectile resolved');
  assert.equal(resolved.payload.outcome, 'blocked');
});
