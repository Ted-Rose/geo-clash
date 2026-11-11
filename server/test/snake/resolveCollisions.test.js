import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCollisions } from '../../src/snake/collisions.js';
import { COLLISION_RADIUS_M, SPAWN_GRACE_MS } from '../../src/snake/constants.js';
import { metersToDegLat } from '../../src/shared/gridUtils.js';

const PAST_GRACE = () => Date.now() - SPAWN_GRACE_MS - 100;

function player(id, over = {}) {
  return {
    id,
    lat: 51.5,
    lng: -0.12,
    alive: true,
    spawnedAt: PAST_GRACE(),
    tailPoints: [],
    ...over,
  };
}

test('resolveCollisions: spawn-grace player can neither kill nor be killed', () => {
  // A is inside the grace window, B is not. Heads overlap (head-on-head)
  // AND A has a tail segment under B's head — still zero kills either way.
  const players = {
    A: player('A', { spawnedAt: Date.now(), tailPoints: [{ lat: 51.5, lng: -0.12 }] }),
    B: player('B'),
  };
  assert.deepEqual(
    resolveCollisions(players),
    [],
    'a player in spawn grace must be fully collision-safe',
  );
});

test('resolveCollisions: head-on-tail takes priority over head-on-head (break after tail hit)', () => {
  const players = {
    // A's head is within radius of B's head AND of B's tail.
    A: player('A'),
    B: player('B', { tailPoints: [{ lat: 51.5, lng: -0.12 }] }),
  };
  const kills = resolveCollisions(players);
  assert.ok(
    kills.some((k) => k.killerId === 'B' && k.victimId === 'A'),
    'tail hit wins over the symmetric head-on-head pair for the victim',
  );
});

test("resolveCollisions: a player's own tail never kills them", () => {
  const players = {
    A: player('A', { tailPoints: [{ lat: 51.5, lng: -0.12 }] }),
  };
  assert.deepEqual(resolveCollisions(players), []);
});

test('resolveCollisions: head just inside COLLISION_RADIUS_M is a hit; just outside is not', () => {
  // NOTE: distanceMeters(metersToDegLat(R)) overshoots R by ~4e-8 m, so we
  // place heads just under / just over rather than exactly at the boundary.
  const near = {
    A: player('A'),
    B: player('B', { lat: 51.5 + metersToDegLat(COLLISION_RADIUS_M * 0.99) }),
  };
  assert.ok(
    resolveCollisions(near).length > 0,
    'heads within the collision radius collide',
  );

  const far = {
    A: player('A'),
    B: player('B', { lat: 51.5 + metersToDegLat(COLLISION_RADIUS_M + 0.1) }),
  };
  assert.deepEqual(resolveCollisions(far), [], 'heads outside the radius do not collide');
});

test('resolveCollisions: alive:false players are skipped entirely', () => {
  // Dead A overlaps B head-on-head and has a tail under B's head —
  // A can neither be victimized nor kill while dead.
  const players = {
    A: player('A', { alive: false, tailPoints: [{ lat: 51.5, lng: -0.12 }] }),
    B: player('B'),
  };
  assert.deepEqual(resolveCollisions(players), []);
});

test('resolveCollisions: inGrace flag is persisted on the passed player objects', () => {
  const grace = player('A', { spawnedAt: Date.now() });
  const aged = player('B', { lat: 51.6 }); // far away, past grace
  resolveCollisions({ A: grace, B: aged });
  assert.equal(grace.inGrace, true, 'grace flag set on the stored object');
  assert.equal(aged.inGrace, false, 'aged player marked out of grace');
});
