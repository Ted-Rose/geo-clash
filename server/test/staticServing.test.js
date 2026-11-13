// Tests for the optional static-SPA serving in app.js. A temp dist dir
// is injected via buildServer({ clientDist }) — covering the index.html
// fallback, vercel.json-mirrored cache headers, API route precedence
// and the missing-build-dir no-op.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildServer } from '../src/app.js';

const NO_STORE = 'no-cache, no-store, must-revalidate';

// Spins up buildServer on an ephemeral port; registers cleanup that
// closes both socket.io and the HTTP server.
async function startServer(t, opts = {}) {
  const parts = await buildServer(opts);
  parts.server.listen(0);
  await new Promise((r) => parts.server.once('listening', r));
  t.after(async () => {
    parts.io.close();
    if (parts.server.listening) {
      await new Promise((r) => parts.server.close(r));
    }
  });
  return `http://127.0.0.1:${parts.server.address().port}`;
}

// Minimal client build: index.html, a hashed asset, sw.js, a workbox
// chunk and the PWA manifest.
function makeDist(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-clash-dist-'));
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>spa-shell</html>');
  fs.writeFileSync(
    path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1);'
  );
  fs.writeFileSync(path.join(dir, 'sw.js'), 'self.__WB = 1;');
  fs.writeFileSync(
    path.join(dir, 'workbox-1234abcd.js'), 'self.__WBX = 1;'
  );
  fs.writeFileSync(
    path.join(dir, 'manifest.webmanifest'), '{"name":"geo"}'
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('GET / and deep links serve index.html with no-store', async (t) => {
  const base = await startServer(t, { clientDist: makeDist(t) });

  for (const p of ['/', '/index.html', '/room/abc/some/deep/link']) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200, `GET ${p}`);
    assert.match(await res.text(), /spa-shell/, `GET ${p}`);
    assert.equal(
      res.headers.get('cache-control'), NO_STORE,
      `GET ${p} must not be cached`
    );
  }
});

test('static files get the vercel.json cache contract', async (t) => {
  const base = await startServer(t, { clientDist: makeDist(t) });

  let res = await fetch(`${base}/assets/app-abc123.js`);
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get('cache-control'),
    'public, max-age=31536000, immutable'
  );
  assert.match(
    res.headers.get('content-type'), /javascript/,
    'hashed asset served with a JS content type'
  );

  for (const p of ['/sw.js', '/workbox-1234abcd.js']) {
    res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200, `GET ${p}`);
    assert.equal(res.headers.get('cache-control'), NO_STORE, `GET ${p}`);
  }

  res = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get('cache-control'),
    'public, max-age=3600, must-revalidate'
  );
});

test('API and health routes are never swallowed by the SPA', async (t) => {
  const base = await startServer(t, { clientDist: makeDist(t) });

  let res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  res = await fetch(`${base}/api/rooms`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray((await res.json()).rooms));

  // An unknown /api path is a real 404, not an index.html rewrite.
  res = await fetch(`${base}/api/definitely-not-a-route`);
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /spa-shell/);
});

test('non-GET deep links never hit the SPA fallback', async (t) => {
  const base = await startServer(t, { clientDist: makeDist(t) });

  // The fallback is registered GET-only, so a POST must get the
  // Express 404 — never index.html.
  const res = await fetch(`${base}/room/abc/some/deep/link`, {
    method: 'POST',
  });
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /spa-shell/);
});

test('missing build dir leaves the API-only server unchanged', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-clash-nodist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const missing = path.join(dir, 'no-such-dir');
  const base = await startServer(t, { clientDist: missing });

  let res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  res = await fetch(`${base}/`);
  assert.equal(res.status, 404, 'no build → no SPA fallback');
});
