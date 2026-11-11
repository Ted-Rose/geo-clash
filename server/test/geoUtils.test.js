// Pure-math tests for shared/gridUtils.js geo helpers.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceMeters,
  metersToDegLat,
  metersToDegLng,
  bboxAround,
} from '../src/shared/gridUtils.js';

test('distanceMeters: same point 0, ~111.19km per degree lat, symmetric', () => {
  const p = { lat: 51.5, lng: -0.12 };
  assert.equal(distanceMeters(p, p), 0);

  const deg = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(deg - 111_195) < 500, `1° lat ≈ 111.195 km, got ${deg}`);

  const a = { lat: 51.5, lng: -0.12 };
  const b = { lat: 51.5005, lng: -0.118 };
  const ab = distanceMeters(a, b);
  const ba = distanceMeters(b, a);
  assert.ok(Math.abs(ab - ba) < 1e-6, 'distance is symmetric');
  assert.ok(ab > 10 && ab < 500, `small-scale distance sane, got ${ab}m`);
});

test('metersToDegLat/Lng conversions and latitude dependence', () => {
  // Inverse check: 1° lat on this model is EARTH_R*pi/180 ≈ 111.32 km.
  const oneDegM = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(metersToDegLat(oneDegM) - 1) < 1e-9);

  const m = 1000;
  assert.ok(
    Math.abs(metersToDegLng(m, 0) - metersToDegLat(m)) < 1e-9,
    'deg lng ≈ deg lat at the equator'
  );
  const ratio = metersToDegLng(m, 60) / metersToDegLng(m, 0);
  assert.ok(Math.abs(ratio - 2) < 1e-9, 'cos(60°)=0.5 → 2× degrees at 60°N');
});

test('bboxAround centers on point and spans ~sideMeters', () => {
  const lat = 51.5;
  const lng = -0.12;
  const bbox = bboxAround(lat, lng); // default 120 m side

  assert.equal((bbox.north + bbox.south) / 2, lat, 'centered on lat');
  assert.equal((bbox.east + bbox.west) / 2, lng, 'centered on lng');

  const ns = distanceMeters(
    { lat: bbox.south, lng },
    { lat: bbox.north, lng }
  );
  assert.ok(Math.abs(ns - 120) / 120 < 0.01, `N-S span ≈ 120 m, got ${ns}`);

  const ew = distanceMeters(
    { lat, lng: bbox.west },
    { lat, lng: bbox.east }
  );
  assert.ok(Math.abs(ew - 120) / 120 < 0.05, `E-W span ≈ 120 m, got ${ew}`);

  const custom = bboxAround(lat, lng, 40);
  const customNs = distanceMeters(
    { lat: custom.south, lng },
    { lat: custom.north, lng }
  );
  assert.ok(Math.abs(customNs - 40) / 40 < 0.01, 'custom sideMeters honored');
});
