import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGame,
  eventsNamed,
  patchPlayer,
  sleep,
} from './helpers.js';
import { targetFromHeading } from '../../src/clash/projectiles.js';

const ORIGIN = { lat: 51.5, lng: -0.12 };

test('attack decrements ammo and emits scoped ammo-update', async (t) => {
  const { io, game } = makeGame(t, { maxAmmo: 3 });
  await game.addPlayer('A', 'Alice');
  await game.updateLocation('A', ORIGIN.lat, ORIGIN.lng, 0);

  await game.attack('A');
  const p = await game.playerStore.get('A');
  assert.equal(p.ammo, 2);
  const upd = eventsNamed(io, 'ammo-update');
  assert.equal(upd.length, 1);
  assert.equal(upd[0].scope, 'A', 'ammo-update scoped to the attacker');
  assert.deepEqual(upd[0].payload, { ammo: 2, maxAmmo: 3 });
});

test('attack is blocked at zero ammo', async (t) => {
  const { io, game } = makeGame(t, { maxAmmo: 1 });
  await game.addPlayer('A', 'Alice');
  await game.updateLocation('A', ORIGIN.lat, ORIGIN.lng, 0);

  await game.attack('A');
  await game.attack('A');
  assert.equal(eventsNamed(io, 'projectile-spawn').length, 1);
  const p = await game.playerStore.get('A');
  assert.equal(p.ammo, 0, 'never goes negative');
});

test('ammo recharges +1 after ammoRenewalMs', async (t) => {
  const { io, game } = makeGame(t, { maxAmmo: 2, ammoRenewalMs: 500 });
  await game.addPlayer('A', 'Alice');
  await game.updateLocation('A', ORIGIN.lat, ORIGIN.lng, 0);

  await game.attack('A');
  assert.equal((await game.playerStore.get('A')).ammo, 1);

  await sleep(700); // real wall clock — recharge is a real setTimeout
  assert.equal((await game.playerStore.get('A')).ammo, 2);
  const upds = eventsNamed(io, 'ammo-update');
  assert.equal(upds.length, 2);
  assert.equal(upds[1].scope, 'A');
  assert.deepEqual(upds[1].payload, { ammo: 2, maxAmmo: 2 });
});

test('recharge follows the socket id after swapSocketId', async (t) => {
  const { io, game } = makeGame(t, { maxAmmo: 2, ammoRenewalMs: 500 });
  await game.addPlayer('A', 'Alice');
  await game.updateLocation('A', ORIGIN.lat, ORIGIN.lng, 0);

  await game.attack('A');
  assert.equal((await game.playerStore.get('A')).ammo, 1);

  // sessionId reconnect re-keys the player record mid-recharge
  await game.swapSocketId('A', 'A2');
  assert.equal(await game.playerStore.get('A'), undefined);
  assert.equal((await game.playerStore.get('A2')).ammo, 1);

  await sleep(700); // real wall clock — recharge is a real setTimeout
  assert.equal((await game.playerStore.get('A2')).ammo, 2);
  const upds = eventsNamed(io, 'ammo-update');
  const last = upds[upds.length - 1];
  assert.equal(last.scope, 'A2', 'ammo-update scoped to the new socket id');
  assert.deepEqual(last.payload, { ammo: 2, maxAmmo: 2 });
});

test('recharge never exceeds maxAmmo', async (t) => {
  const { io, game } = makeGame(t, { maxAmmo: 2, ammoRenewalMs: 500 });
  await game.addPlayer('A', 'Alice'); // ammo already at maxAmmo

  game._scheduleAmmoRecharge('A');
  await sleep(700);
  assert.equal((await game.playerStore.get('A')).ammo, 2);
  const upd = eventsNamed(io, 'ammo-update');
  assert.equal(upd.length, 1);
  assert.equal(upd[0].payload.ammo, 2, 'capped at maxAmmo');
});

test('maxAmmo:null means unlimited', async (t) => {
  const { io, game } = makeGame(t); // default: no ammo rules
  await game.addPlayer('A', 'Alice');
  await game.updateLocation('A', ORIGIN.lat, ORIGIN.lng, 0);

  await game.attack('A', { target: targetFromHeading(ORIGIN, 0, 10) });
  await game.attack('A', { target: targetFromHeading(ORIGIN, 0, 10) });
  assert.equal(eventsNamed(io, 'projectile-spawn').length, 2);
  assert.equal((await game.playerStore.get('A')).ammo, null);
  assert.equal(eventsNamed(io, 'ammo-update').length, 0);
});

test('removePlayer cancels the pending recharge; ' +
     'no ammo-update after leave', async (t) => {
  const { io, game } = makeGame(t, { maxAmmo: 2, ammoRenewalMs: 500 });
  await game.addPlayer('A', 'Alice');
  await game.updateLocation('A', ORIGIN.lat, ORIGIN.lng, 0);

  await game.attack('A'); // ammo 1, one recharge scheduled
  assert.equal(game._ammoTimers.size, 1);

  await game.removePlayer('A');
  assert.equal(game._ammoTimers.size, 0, 'recharge cancelled');

  await sleep(700); // long enough for the cancelled timer's window
  const upds = eventsNamed(io, 'ammo-update');
  assert.equal(upds.length, 1, 'only the attack-time emit remains');
});

test('respawn refills ammo to maxAmmo', async (t) => {
  const { io, game } = makeGame(t, { maxAmmo: 3 });
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'Alice'); // spawns at base cell center
  await game.attack('A');
  assert.equal((await game.playerStore.get('A')).ammo, 2);
  await patchPlayer(game, 'A', { alive: false, lives: 0 });

  await game.respawn('A');
  const p = await game.playerStore.get('A');
  assert.equal(p.ammo, 3);
  const upds = eventsNamed(io, 'ammo-update');
  const last = upds[upds.length - 1];
  assert.equal(last.scope, 'A');
  assert.deepEqual(last.payload, { ammo: 3, maxAmmo: 3 });
});
