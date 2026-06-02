// Clash-specific grid helpers: bounding-box → cell grid slicing.
// Pure geo math lives in ../shared/gridUtils.js.

import { metersToDegLat, metersToDegLng } from '../shared/gridUtils.js';

export const CELL_METERS = 5;

// Slice bbox into a 2D grid of cellMeters×cellMeters cells.
// Returns { rows, cols, cellMeters, bbox, cells: [...] }
// Each cell carries its polygon corners so the client can draw it directly.
export function buildGrid(bbox, cellMeters = CELL_METERS) {
  const midLat = (bbox.south + bbox.north) / 2;
  const dLat = metersToDegLat(cellMeters);
  const dLng = metersToDegLng(cellMeters, midLat);

  const rows = Math.max(1, Math.floor((bbox.north - bbox.south) / dLat));
  const cols = Math.max(1, Math.floor((bbox.east - bbox.west) / dLng));

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const south = bbox.south + r * dLat;
      const west = bbox.west + c * dLng;
      const north = south + dLat;
      const east = west + dLng;
      const id = `${r}_${c}`;
      cells.push({
        id,
        r,
        c,
        bounds: { south, west, north, east },
        // polygon corners in [lat,lng] order (Leaflet convention)
        polygon: [
          [south, west],
          [south, east],
          [north, east],
          [north, west],
        ],
      });
    }
  }
  return { rows, cols, cellMeters, bbox, cells };
}

// Which cell contains a given coordinate? Returns the cell id or null.
export function cellIdAt(grid, lat, lng) {
  const { bbox, rows, cols } = grid;
  if (lat < bbox.south || lat >= bbox.north) return null;
  if (lng < bbox.west || lng >= bbox.east) return null;
  const midLat = (bbox.south + bbox.north) / 2;
  const dLat = metersToDegLat(grid.cellMeters);
  const dLng = metersToDegLng(grid.cellMeters, midLat);
  const r = Math.floor((lat - bbox.south) / dLat);
  const c = Math.floor((lng - bbox.west) / dLng);
  if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
  return `${r}_${c}`;
}

// Pick a base station cell (center of the grid) so respawn is always reachable.
export function baseCellId(grid) {
  return `${Math.floor(grid.rows / 2)}_${Math.floor(grid.cols / 2)}`;
}
