// HTTP-level tests for the REST + CORS surface built by app.js —
// /health, /api/rooms GET/POST, /api/leaderboard limit clamping and
// parseCorsOrigin. Binds the app to an ephemeral port and uses real fetch.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, parseCorsOrigin } from '../src/app.js';
import { MemoryLeaderboardStore } from '../src/shared/memoryStore.js';

// Spins up buildServer on an ephemeral port; returns the base URL and the
// pieces. Registers cleanup that closes both socket.io and the HTTP server.
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
  return {
    ...parts,
    base: `http://127.0.0.1:${parts.server.address().port}`,
  };
}

test('GET /health returns {ok:true}', async (t) => {
  const { base } = await startServer(t);
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('GET /api/rooms returns registry list', async (t) => {
  const { base, registry } = await startServer(t);
  const meta = await registry.create({ name: 'REST-room' });
  t.after(() => registry.destroy(meta.id));

  const res = await fetch(`${base}/api/rooms`);
  assert.equal(res.status, 200);
  const { rooms } = await res.json();
  const found = rooms.find((r) => r.id === meta.id);
  assert.ok(found, 'created room listed');
  assert.equal(found.name, 'REST-room');
});

test('POST /api/rooms → 201; registry throw → 500 {error}', async (t) => {
  const { base, registry } = await startServer(t);

  const created = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'via-rest', maxPlayers: 3 }),
  });
  assert.equal(created.status, 201);
  const { room } = await created.json();
  t.after(() => registry.destroy(room.id));
  assert.equal(room.name, 'via-rest');
  assert.equal(room.hostId, null, 'REST-created room is hostless');
  assert.equal(room.maxPlayers, 3);

  // Failure path: injected registry whose create() rejects.
  const stubReg = {
    async init() {},
    async list() { return []; },
    async create() { throw new Error('forced-failure'); },
  };
  const failing = await startServer(t, { registry: stubReg });
  const res = await fetch(`${failing.base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'forced-failure' });
});

test('GET /api/leaderboard clamps limit and passes gameType', async (t) => {
  const leaderboard = new MemoryLeaderboardStore();
  for (let i = 0; i < 105; i++) {
    await leaderboard.archive({
      playerId: `p${i}`, matchId: 'm', name: `p${i}`, color: '#fff',
      score: i, gameType: i % 2 ? 'snake' : 'clash',
      finishedAt: i, roomName: 'r',
    });
  }
  const { base } = await startServer(t, { leaderboard });

  const top = async (q = '') =>
    (await fetch(`${base}/api/leaderboard${q}`)).json();

  let body = await top('?limit=5');
  assert.equal(body.top.length, 5);

  body = await top('?limit=999');
  assert.equal(body.top.length, 100, 'limit clamped to 100');

  body = await top('?limit=0');
  assert.equal(body.top.length, 25, 'limit=0 → default 25');
  body = await top('?limit=abc');
  assert.equal(body.top.length, 25, 'non-numeric → default 25');
  body = await top('');
  assert.equal(body.top.length, 25, 'absent → default 25');

  body = await top('?gameType=snake&limit=100');
  assert.ok(
    body.top.every((e) => e.gameType === 'snake'),
    'gameType filter applied'
  );
});

test('CORS origin handling: reflect-all, single, list, blocked', async (t) => {
  // Reflect-all (parseCorsOrigin equivalent of unset/"*").
  const open = await startServer(t, { corsOrigin: true });
  let res = await fetch(`${open.base}/health`, {
    headers: { Origin: 'https://anything.example' },
  });
  assert.equal(
    res.headers.get('access-control-allow-origin'),
    'https://anything.example',
    'reflect-all echoes the request origin'
  );

  // Single configured origin: cors always returns the configured value.
  const single = await startServer(t, { corsOrigin: 'https://a.com' });
  res = await fetch(`${single.base}/health`, {
    headers: { Origin: 'https://a.com' },
  });
  assert.equal(
    res.headers.get('access-control-allow-origin'),
    'https://a.com'
  );

  // List: allowed origins get reflected, others get no header at all.
  const listed = await startServer(t, {
    corsOrigin: ['https://a.com', 'https://b.com'],
  });
  res = await fetch(`${listed.base}/health`, {
    headers: { Origin: 'https://b.com' },
  });
  assert.equal(
    res.headers.get('access-control-allow-origin'),
    'https://b.com'
  );

  res = await fetch(`${listed.base}/health`, {
    headers: { Origin: 'https://evil.com' },
  });
  assert.equal(
    res.headers.get('access-control-allow-origin'),
    null,
    'non-listed origin gets no CORS header'
  );

  // Wildcard entries (Vercel preview hostnames) match via RegExp.
  const preview = await startServer(t, {
    corsOrigin: parseCorsOrigin(
      'https://a.com,https://app-*-team.vercel.app'
    ),
  });
  res = await fetch(`${preview.base}/health`, {
    headers: { Origin: 'https://app-x1y2z3-team.vercel.app' },
  });
  assert.equal(
    res.headers.get('access-control-allow-origin'),
    'https://app-x1y2z3-team.vercel.app',
    'preview hostname matches the wildcard entry'
  );

  res = await fetch(`${preview.base}/health`, {
    headers: { Origin: 'https://app-x1y2z3-team.vercel.app.evil.com' },
  });
  assert.equal(
    res.headers.get('access-control-allow-origin'),
    null,
    'wildcard must not match a suffix-spoofed origin'
  );
});

test('parseCorsOrigin unit cases', (t) => {
  // The mixed-'*' cases log a warning; silence it for these assertions.
  t.mock.method(console, 'warn', () => {});
  assert.equal(parseCorsOrigin(undefined), true);
  assert.equal(parseCorsOrigin(''), true);
  assert.equal(parseCorsOrigin('  '), true);
  assert.equal(parseCorsOrigin('*'), true);
  assert.equal(parseCorsOrigin('https://a.com'), 'https://a.com');
  assert.deepEqual(
    parseCorsOrigin('https://a.com, https://b.com ,,https://c.com'),
    ['https://a.com', 'https://b.com', 'https://c.com'],
    'trims entries and drops empties'
  );

  const wildcard = parseCorsOrigin(
    'https://app-*-team.vercel.app,https://a.com'
  );
  assert.ok(wildcard[0] instanceof RegExp, "'*' entry becomes a RegExp");
  assert.equal(wildcard[1], 'https://a.com');
  assert.ok(wildcard[0].test('https://app-abc123-team.vercel.app'));
  assert.ok(!wildcard[0].test('https://app-abc123-team.vercel.app.evil.com'));
  assert.ok(!wildcard[0].test('https://other-team.vercel.app'));

  assert.equal(
    parseCorsOrigin('https://a.com,*'),
    'https://a.com',
    "a '*' mixed into a list is dropped, not reflect-all"
  );
  assert.deepEqual(
    parseCorsOrigin('*,https://a.com,https://b.com'),
    ['https://a.com', 'https://b.com'],
    "a leading '*' among real origins is ignored"
  );
});
