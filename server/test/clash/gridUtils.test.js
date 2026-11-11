import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, cellIdAt, baseCellId } from '../../src/clash/gridUtils.js';
import { targetFromHeading } from '../../src/clash/projectiles.js';
import { bboxAround, distanceMeters } from '../../src/shared/gridUtils.js';

const CENTER = { lat: 51.5, lng: -0.12 };

test('buildGrid slices a known bbox into expected rows x cols', () => {
  const bbox = bboxAround(CENTER.lat, CENTER.lng, 100);
  const grid = buildGrid(bbox, 10);
  assert.equal(grid.rows, 10);
  assert.equal(grid.cols, 10);
  assert.equal(grid.cells.length, 100);
  assert.equal(grid.cellMeters, 10);
  assert.deepEqual(grid.bbox, bbox);
});

test('buildGrid cell ids, bounds and polygon are consistent', () => {
  const bbox = bboxAround(CENTER.lat, CENTER.lng, 100);
  const grid = buildGrid(bbox, 10);
  const first = grid.cells[0];
  assert.equal(first.id, '0_0');
  assert.equal(first.bounds.south, bbox.south);
  assert.equal(first.bounds.west, bbox.west);
  const { south, west, north, east } = first.bounds;
  // polygon corners in [lat,lng] order (Leaflet convention)
  assert.deepEqual(first.polygon, [
    [south, west],
    [south, east],
    [north, east],
    [north, west],
  ]);
  const last = grid.cells[grid.cells.length - 1];
  assert.equal(last.id, '9_9');
});

test('buildGrid clamps to >=1 row/col for a sub-cell bbox', () => {
  const bbox = bboxAround(CENTER.lat, CENTER.lng, 4); // < cellMeters
  const grid = buildGrid(bbox, 10);
  assert.equal(grid.rows, 1);
  assert.equal(grid.cols, 1);
  assert.equal(grid.cells.length, 1);
  assert.equal(grid.cells[0].id, '0_0');
});

test('cellIdAt returns the containing cell id', () => {
  const grid = buildGrid(bboxAround(CENTER.lat, CENTER.lng, 100), 10);
  const cell = grid.cells.find((c) => c.id === '3_4');
  const mid = {
    lat: (cell.bounds.south + cell.bounds.north) / 2,
    lng: (cell.bounds.west + cell.bounds.east) / 2,
  };
  assert.equal(cellIdAt(grid, mid.lat, mid.lng), '3_4');
});

test('cellIdAt: south/west edges inclusive, north/east exclusive', () => {
  const bbox = bboxAround(CENTER.lat, CENTER.lng, 100);
  const grid = buildGrid(bbox, 10);
  assert.equal(cellIdAt(grid, bbox.south, bbox.west), '0_0');
  assert.equal(cellIdAt(grid, bbox.north, bbox.west), null);
  assert.equal(cellIdAt(grid, bbox.south, bbox.east), null);
});

test('cellIdAt returns null outside the bbox', () => {
  const bbox = bboxAround(CENTER.lat, CENTER.lng, 100);
  const grid = buildGrid(bbox, 10);
  const eps = 1e-6;
  assert.equal(cellIdAt(grid, bbox.south - eps, CENTER.lng), null);
  assert.equal(cellIdAt(grid, bbox.north + eps, CENTER.lng), null);
  assert.equal(cellIdAt(grid, CENTER.lat, bbox.west - eps), null);
  assert.equal(cellIdAt(grid, CENTER.lat, bbox.east + eps), null);
});

test('baseCellId returns the floor-center cell', () => {
  const g10 = buildGrid(bboxAround(CENTER.lat, CENTER.lng, 100), 10);
  assert.equal(baseCellId(g10), '5_5');
  const g3 = buildGrid(bboxAround(CENTER.lat, CENTER.lng, 30), 10);
  assert.equal(g3.rows, 3);
  assert.equal(g3.cols, 3);
  assert.equal(baseCellId(g3), '1_1');
});

test('targetFromHeading at 90deg projects eastward ~range', () => {
  const t = targetFromHeading(CENTER, 90, 30);
  assert.ok(t.lng > CENTER.lng, 'eastward: lng grows');
  // equirectangular approx: distance is close to but not exactly range
  assert.ok(Math.abs(distanceMeters(CENTER, t) - 30) < 1);
});
