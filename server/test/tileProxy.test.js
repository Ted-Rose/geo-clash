// HTTP-level tests for tileProxy.js — imagery-age 404 enforcement,
// metadata cache, upstream error mapping, and tileToBBox geometry.
// globalThis.fetch is stubbed: requests to the local test server pass
// through to the real fetch; Esri metadata/tile URLs return canned data.

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import tileProxy from '../src/tileProxy.js';

const realFetch = globalThis.fetch;
const YEAR_MS = 365 * 24 * 3600 * 1000;

// Installs a fetch stub. `onMetadata(url)` / `onTile(url)` return a
// Response (or throw); anything else falls through to real fetch.
function installFetchStub(t, { onMetadata, onTile }) {
  const counts = { metadata: 0, tile: 0, metadataUrls: [] };
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('arcgisonline.com') && u.includes('/query')) {
      counts.metadata++;
      counts.metadataUrls.push(u);
      return onMetadata(u);
    }
    if (u.includes('arcgisonline.com') && u.includes('/tile/')) {
      counts.tile++;
      return onTile(u);
    }
    return realFetch(url, opts);
  };
  t.after(() => { globalThis.fetch = realFetch; });
  return counts;
}

async function startTileApp(t) {
  const app = express();
  app.use('/t', tileProxy);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

const freshMetadata = () => new Response(JSON.stringify({
  features: [{ attributes: { src_date: Date.now() - YEAR_MS } }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const oldMetadata = () => new Response(JSON.stringify({
  features: [{ attributes: { src_date: Date.now() - 5 * YEAR_MS } }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const pngTile = () => new Response(new Uint8Array([1, 2, 3, 4]), {
  status: 200, headers: { 'Content-Type': 'image/png' },
});

test('fresh imagery proxies tile with upstream headers', async (t) => {
  const counts = installFetchStub(t, { onMetadata: freshMetadata, onTile: pngTile });
  const base = await startTileApp(t);

  const res = await realFetch(`${base}/t/11/1000/1001`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(
    res.headers.get('cache-control'),
    'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400'
  );
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3, 4]);
  assert.equal(counts.metadata, 1);
  assert.equal(counts.tile, 1);
});

test('imagery older than maxAge returns 404 and skips tile fetch', async (t) => {
  const counts = installFetchStub(t, { onMetadata: oldMetadata, onTile: pngTile });
  const base = await startTileApp(t);

  const res = await realFetch(`${base}/t/12/1002/1003`);
  assert.equal(res.status, 404);
  assert.equal(await res.text(), 'Imagery too old');
  assert.equal(counts.tile, 0, 'tile fetch skipped for stale imagery');
});

test('maxAge query param adjusts cutoff; invalid value uses default 3', async (t) => {
  installFetchStub(t, { onMetadata: oldMetadata, onTile: pngTile });
  const base = await startTileApp(t);

  // Same 5y-old imagery, but maxAge=10 years allows it.
  const allowed = await realFetch(`${base}/t/13/1004/1005?maxAge=10`);
  assert.equal(allowed.status, 200);

  // maxAge=abc → parseInt NaN → default 3 → still too old.
  const invalid = await realFetch(`${base}/t/13/1006/1007?maxAge=abc`);
  assert.equal(invalid.status, 404);

  // maxAge=0 → falsy → default 3 → too old.
  const zero = await realFetch(`${base}/t/13/1008/1009?maxAge=0`);
  assert.equal(zero.status, 404);
});

test('missing or failed metadata proxies the tile through', async (t) => {
  const base = await startTileApp(t);
  const cases = [
    ['14/1010/1011', () => { throw new Error('network down'); }],
    ['14/1012/1013', () => new Response(JSON.stringify({ features: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })],
    ['14/1014/1015', () => new Response('boom', { status: 500 })],
  ];
  for (const [path, onMetadata] of cases) {
    const counts = installFetchStub(t, { onMetadata, onTile: pngTile });
    const res = await realFetch(`${base}/t/${path}`);
    assert.equal(res.status, 200, `metadata failure should proxy: ${path}`);
    assert.equal(counts.tile, 1);
    globalThis.fetch = realFetch;
  }
});

test('upstream tile non-OK forwards its status', async (t) => {
  installFetchStub(t, {
    onMetadata: freshMetadata,
    onTile: () => new Response('x', { status: 503 }),
  });
  const base = await startTileApp(t);

  const res = await realFetch(`${base}/t/17/1016/1017`);
  assert.equal(res.status, 503);
});

test('upstream tile fetch throwing yields 502', async (t) => {
  installFetchStub(t, {
    onMetadata: freshMetadata,
    onTile: () => { throw new Error('tls reset'); },
  });
  const base = await startTileApp(t);

  const res = await realFetch(`${base}/t/18/1018/1019`);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'Source fetch failed' });
});

test('metadata cache dedupes repeat requests and expires after TTL', async (t) => {
  const counts = installFetchStub(t, { onMetadata: freshMetadata, onTile: pngTile });
  const base = await startTileApp(t);
  t.mock.timers.enable({ apis: ['Date'] });

  await realFetch(`${base}/t/19/1020/1021`);
  await realFetch(`${base}/t/19/1020/1021`);
  assert.equal(counts.metadata, 1, 'second request hits the cache');
  assert.equal(counts.tile, 2, 'tile itself still fetched each time');

  t.mock.timers.tick(3_601_000); // > 1h CACHE_TTL
  await realFetch(`${base}/t/19/1020/1021`);
  assert.equal(counts.metadata, 2, 'cache expired → metadata refetched');
});

test('tileToBBox produces correct envelope (via geometry param)', async (t) => {
  const counts = installFetchStub(t, { onMetadata: freshMetadata, onTile: pngTile });
  const base = await startTileApp(t);

  const geometryFor = async (z, y, x) => {
    await realFetch(`${base}/t/${z}/${y}/${x}`);
    const url = counts.metadataUrls.at(-1);
    return new URL(url).searchParams.get('geometry').split(',').map(Number);
  };

  // z=0,x=0,y=0 → whole world
  let [w, s, e, n] = await geometryFor(0, 0, 0);
  assert.equal(w, -180);
  assert.equal(e, 180);
  assert.ok(Math.abs(n - 85.05) < 0.1, `north ~85.05, got ${n}`);
  assert.ok(Math.abs(s + 85.05) < 0.1, `south ~-85.05, got ${s}`);

  // z=1,x=0,y=0 → NW quarter
  [w, s, e, n] = await geometryFor(1, 0, 0);
  assert.equal(w, -180);
  assert.equal(e, 0);
  assert.ok(Math.abs(n - 85.05) < 0.1);
  assert.equal(s, 0);

  // z=2,x=2,y=1 → west=0, east=90
  [w, , e] = await geometryFor(2, 1, 2);
  assert.equal(w, 0);
  assert.equal(e, 90);
});
