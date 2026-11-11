import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGame,
  eventsNamed,
  patchPlayer,
} from './helpers.js';
import {
  targetFromHeading,
  ATTACK_RANGE_M,
  HIT_RADIUS_M,
} from '../../src/clash/projectiles.js';
import {
  distanceMeters,
  metersToDegLat,
  metersToDegLng,
} from '../../src/shared/gridUtils.js';

const ORIGIN = { lat: 51.5, lng: -0.12 };

// Common arrange: attacker at ORIGIN, grid auto-seeds on first fix.
async function makeAttacker(game, heading = 0) {
  const a = await game.addPlayer('A', 'attacker');
  await game.updateLocation('A', ORIGIN.lat, ORIGIN.lng, heading);
  return a;
}

function lastSpawn(io) {
  const spawns = eventsNamed(io, 'projectile-spawn');
  return spawns[spawns.length - 1];
}

test('attack clamps an out-of-range explicit target to ATTACK_RANGE_M', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game);
  const far = targetFromHeading(ORIGIN, 0, 100);
  await game.attack('A', { target: far });

  const target = lastSpawn(io).payload.target;
  const dist = distanceMeters(ORIGIN, far);
  const scale = ATTACK_RANGE_M / dist;
  // same direction, exactly `scale` along the origin->target vector
  assert.deepEqual(target, {
    lat: ORIGIN.lat + (far.lat - ORIGIN.lat) * scale,
    lng: ORIGIN.lng + (far.lng - ORIGIN.lng) * scale,
  });
  assert.ok(
    Math.abs(distanceMeters(ORIGIN, target) - ATTACK_RANGE_M) < 0.2,
  );
});

test('attack uses an in-range explicit target verbatim', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game);
  const near = targetFromHeading(ORIGIN, 0, 10);
  await game.attack('A', { target: near });
  assert.deepEqual(lastSpawn(io).payload.target, {
    lat: near.lat,
    lng: near.lng,
  });
});

test('attack auto-aims at the nearest enemy inside the 25deg cone', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game, 0);
  const e1 = targetFromHeading(ORIGIN, 0, 10);   // dead ahead, in cone
  const e2 = targetFromHeading(ORIGIN, 40, 5);   // outside the cone
  const e3 = targetFromHeading(ORIGIN, 0, 35);   // in cone but out of range
  await game.addPlayer('E1', 'e1');
  await game.addPlayer('E2', 'e2');
  await game.addPlayer('E3', 'e3');
  await game.updateLocation('E1', e1.lat, e1.lng);
  await game.updateLocation('E2', e2.lat, e2.lng);
  await game.updateLocation('E3', e3.lat, e3.lng);

  await game.attack('A', { heading: 0 });
  assert.deepEqual(lastSpawn(io).payload.target, {
    lat: e1.lat,
    lng: e1.lng,
  });
});

test('attack falls back to targetFromHeading at full range when no enemy in cone', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game, 0);
  await game.attack('A', { heading: 0 });
  assert.deepEqual(
    lastSpawn(io).payload.target,
    targetFromHeading(ORIGIN, 0, ATTACK_RANGE_M),
  );
});

test('attack heading argument overrides stored heading; non-number falls back', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game, 90); // stored heading east

  await game.attack('A', { heading: 0 });
  assert.deepEqual(
    lastSpawn(io).payload.target,
    targetFromHeading(ORIGIN, 0, ATTACK_RANGE_M),
    'explicit heading wins',
  );

  await game.attack('A', { heading: 'x' });
  assert.deepEqual(
    lastSpawn(io).payload.target,
    targetFromHeading(ORIGIN, 90, ATTACK_RANGE_M),
    'non-number heading falls back to stored heading',
  );
});

test('attack by dead or unknown player is a no-op', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game);
  await patchPlayer(game, 'A', { alive: false });
  await game.attack('A', { target: targetFromHeading(ORIGIN, 0, 10) });
  await game.attack('ZZ', { target: targetFromHeading(ORIGIN, 0, 10) });
  assert.equal(eventsNamed(io, 'projectile-spawn').length, 0);
  assert.equal((await game.projectileStore.all()).length, 0);
});

test('attack after endMatch is a no-op', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game);
  game.status = 'ended'; // pin the status guard specifically
  await game.attack('A', { target: targetFromHeading(ORIGIN, 0, 10) });
  assert.equal(eventsNamed(io, 'projectile-spawn').length, 0);
  assert.equal((await game.projectileStore.all()).length, 0);
});

test('resolve: miss when nobody is within HIT_RADIUS_M', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game);
  await game.attack('A', { target: targetFromHeading(ORIGIN, 0, 10) });
  const id = lastSpawn(io).payload.id;

  await game._resolveProjectile(id);
  const res = eventsNamed(io, 'projectile-resolved')
    .find((e) => e.payload.id === id);
  assert.ok(res, 'projectile-resolved emitted');
  assert.equal(res.payload.outcome, 'expired');
  assert.equal(res.payload.victimId, null);
  assert.equal(await game.projectileStore.get(id), undefined);
});

test('resolve: hit decrements lives and lives->0 marks dead', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game);
  const target = targetFromHeading(ORIGIN, 0, 10);
  await game.addPlayer('V', 'victim');
  await game.updateLocation('V', target.lat, target.lng);
  await patchPlayer(game, 'V', { lives: 1 });

  await game.attack('A', { target });
  const id = lastSpawn(io).payload.id;
  await game._resolveProjectile(id);

  const res = eventsNamed(io, 'projectile-resolved')
    .find((e) => e.payload.id === id);
  assert.equal(res.payload.outcome, 'hit');
  assert.equal(res.payload.victimId, 'V');
  const hits = eventsNamed(io, 'player-hit');
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].payload, { id: 'V', lives: 0, alive: false });
  const v = await game.playerStore.get('V');
  assert.equal(v.lives, 0);
  assert.equal(v.alive, false);
});

test('resolve: nearest victim inside the hit radius is chosen', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game);
  const target = targetFromHeading(ORIGIN, 0, 20);
  const vNear = { lat: target.lat + metersToDegLat(0.5), lng: target.lng };
  const vFar = {
    lat: target.lat,
    lng: target.lng + metersToDegLng(1.2, target.lat),
  };
  await game.addPlayer('N', 'near');
  await game.addPlayer('F', 'far');
  await game.updateLocation('N', vNear.lat, vNear.lng);
  await game.updateLocation('F', vFar.lat, vFar.lng);

  await game.attack('A', { target });
  const id = lastSpawn(io).payload.id;
  await game._resolveProjectile(id);
  const res = eventsNamed(io, 'projectile-resolved')
    .find((e) => e.payload.id === id);
  assert.equal(res.payload.outcome, 'hit');
  assert.equal(res.payload.victimId, 'N');
});

test('resolve: victim inside HIT_RADIUS_M hits, just outside misses', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game);
  const target = targetFromHeading(ORIGIN, 0, 20);
  await game.addPlayer('V', 'victim');

  // just inside the radius -> hit
  const inside = {
    lat: target.lat + metersToDegLat(HIT_RADIUS_M - 0.01),
    lng: target.lng,
  };
  await game.updateLocation('V', inside.lat, inside.lng);
  await game.attack('A', { target });
  let id = lastSpawn(io).payload.id;
  await game._resolveProjectile(id);
  let res = eventsNamed(io, 'projectile-resolved')
    .find((e) => e.payload.id === id);
  assert.equal(res.payload.outcome, 'hit');

  // just outside the radius -> expired
  const outside = {
    lat: target.lat + metersToDegLat(HIT_RADIUS_M + 0.01),
    lng: target.lng,
  };
  await game.updateLocation('V', outside.lat, outside.lng);
  await game.attack('A', { target });
  id = lastSpawn(io).payload.id;
  await game._resolveProjectile(id);
  res = eventsNamed(io, 'projectile-resolved')
    .find((e) => e.payload.id === id);
  assert.equal(res.payload.outcome, 'expired');
  assert.equal(res.payload.victimId, null);
});

test('resolve: an expired shield does not block', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game);
  const target = targetFromHeading(ORIGIN, 0, 10);
  await game.addPlayer('V', 'victim');
  await game.updateLocation('V', target.lat, target.lng);
  await patchPlayer(game, 'V', {
    shieldActive: true,
    shieldUntil: Date.now() - 1000, // expired
  });

  await game.attack('A', { target });
  const id = lastSpawn(io).payload.id;
  await game._resolveProjectile(id);
  const res = eventsNamed(io, 'projectile-resolved')
    .find((e) => e.payload.id === id);
  assert.equal(res.payload.outcome, 'hit');
});

test('resolve: attacker and dead players are excluded from victim scan', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game);

  // attacker standing on his own committed target point
  await game.attack('A', { target: { ...ORIGIN } });
  let id = lastSpawn(io).payload.id;
  await game._resolveProjectile(id);
  let res = eventsNamed(io, 'projectile-resolved')
    .find((e) => e.payload.id === id);
  assert.equal(res.payload.outcome, 'expired');

  // dead enemy exactly on target
  const target = targetFromHeading(ORIGIN, 0, 10);
  await game.addPlayer('V', 'victim');
  await game.updateLocation('V', target.lat, target.lng);
  await patchPlayer(game, 'V', { alive: false });
  await game.attack('A', { target });
  id = lastSpawn(io).payload.id;
  await game._resolveProjectile(id);
  res = eventsNamed(io, 'projectile-resolved')
    .find((e) => e.payload.id === id);
  assert.equal(res.payload.outcome, 'expired');
});

test('resolve is idempotent / no-op for missing projectile', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game);
  await game.attack('A', { target: targetFromHeading(ORIGIN, 0, 10) });
  const id = lastSpawn(io).payload.id;

  await game._resolveProjectile(id);
  await game._resolveProjectile(id); // already deleted -> no-op
  await game._resolveProjectile('no-such-id');
  assert.equal(eventsNamed(io, 'projectile-resolved').length, 1);
});

test('resolve is a no-op once status is ending/ended', async (t) => {
  const { io, game } = makeGame(t);
  await makeAttacker(game);
  await game.attack('A', { target: targetFromHeading(ORIGIN, 0, 10) });
  const id = lastSpawn(io).payload.id;

  game.status = 'ended';
  await game._resolveProjectile(id);
  assert.equal(eventsNamed(io, 'projectile-resolved').length, 0);
  const proj = await game.projectileStore.get(id);
  assert.equal(proj.status, 'in-flight', 'projectile untouched');
});
