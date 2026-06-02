import test from 'node:test';
import assert from 'node:assert/strict';
import { collidesWithTail } from '../../src/snake/collisions.js';
import { COLLISION_RADIUS_M, NECK_GAP_M } from '../../src/snake/constants.js';
import { metersToDegLat } from '../../src/shared/gridUtils.js';

const stepLat = metersToDegLat(COLLISION_RADIUS_M * 0.5);

test('collidesWithTail: head inside tail segment radius → true', () => {
  const tail = [
    { lat: 51.5, lng: -0.12 },
    { lat: 51.5 + stepLat, lng: -0.12 },
  ];
  const head = { lat: 51.5, lng: -0.12 };
  assert.ok(collidesWithTail(head, tail, 0));
});

test('collidesWithTail: head outside radius → false', () => {
  const farLat = metersToDegLat(50);
  const tail = [{ lat: 51.5 + farLat, lng: -0.12 }];
  const head = { lat: 51.5, lng: -0.12 };
  assert.equal(collidesWithTail(head, tail, 0), false);
});

test('collidesWithTail: neck-gap segments are skipped', () => {
  // Place tail segments within NECK_GAP_M of the head — should be ignored
  const nearStep = metersToDegLat(NECK_GAP_M * 0.3);
  const tail = [
    { lat: 51.5 + nearStep, lng: -0.12 },
    { lat: 51.5 + nearStep * 2, lng: -0.12 },
  ];
  const head = { lat: 51.5, lng: -0.12 };
  assert.equal(collidesWithTail(head, tail), false, 'neck gap should protect');
});
