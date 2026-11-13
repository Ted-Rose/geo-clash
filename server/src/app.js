// Express app + Socket.io wiring for Geo Clash. Extracted from index.js
// so tests can bind the HTTP surface to an ephemeral port without the
// entrypoint auto-listening.

import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server as IOServer } from 'socket.io';
import { RoomRegistry } from './roomRegistry.js';
import { registerSocketHandlers } from './socketHandlers.js';
import { leaderboardStore } from './shared/memoryStore.js';
import tileProxy from './tileProxy.js';

// CORS_ORIGIN parsing:
//   - unset / empty               → false: no cross-origin headers at
//     all (fail closed — a missing prod var must never reopen
//     reflect-all; dev is unaffected since the Vite proxy keeps
//     traffic same-origin)
//   - "*"                         → allow any origin (reflect), dev only
//   - "a,b,c"                     → allow exactly those origins
//   - entry containing '*'        → RegExp where '*' matches one
//     hostname run ([a-z0-9-]+), e.g. Vercel preview deploys:
//     "https://app-*-team.vercel.app"
//   - single value                → allow that one origin
// A bare '*' is honored ONLY as the sole entry; mixed with real origins
// it is dropped (warned) — otherwise a stray '*' would silently reopen
// reflect-all on a list meant to be restrictive.
function corsEntryToOrigin(entry) {
  if (!entry.includes('*')) return entry;
  const pattern = entry
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[a-z0-9-]+');
  return new RegExp(`^${pattern}$`, 'i');
}

export function parseCorsOrigin(raw) {
  const value = (raw || '').trim();
  if (value === '') return false;
  if (value === '*') return true;
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // A sole '*' already returned above — a '*' here is necessarily
  // mixed into a real origin list, so warn and drop it.
  if (list.includes('*')) {
    console.warn(
      '[cors] ignoring "*" mixed with explicit origins; ' +
      'reflect-all requires "*" as the only entry'
    );
  }
  const origins = list.filter((e) => e !== '*').map(corsEntryToOrigin);
  return origins.length === 1 ? origins[0] : origins;
}

// Where the Docker image drops the built SPA (../public relative to
// src/); missing in dev → static serving is skipped entirely.
const DEFAULT_CLIENT_DIST = fileURLToPath(
  new URL('../public', import.meta.url)
);

// Cache-Control contract mirrored from vercel.json.
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_NO_STORE = 'no-cache, no-store, must-revalidate';
const CACHE_MANIFEST = 'public, max-age=3600, must-revalidate';

// Builds the express app, HTTP server, Socket.io server and room registry
// WITHOUT listening. `registry` and `leaderboard` are injectable so tests
// can stub failure paths and isolate leaderboard state; `clientDist`
// lets tests point the optional static-SPA mount at a temp dir.
export async function buildServer({
  corsOrigin = parseCorsOrigin(process.env.CORS_ORIGIN),
  registry,
  leaderboard = leaderboardStore,
  clientDist = DEFAULT_CLIENT_DIST,
} = {}) {
  const app = express();
  // Cloud Run sits behind one proxy hop; required so express-rate-limit
  // trusts X-Forwarded-For when deriving req.ip.
  app.set('trust proxy', 1);
  app.use(helmet({
    // Tiles are a public CDN-style resource: a self-hosted deployment
    // may load them cross-origin via <img>, which helmet's default
    // Cross-Origin-Resource-Policy: same-origin would block.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());
  app.use('/api/map/tiles', tileProxy);
  // Generous cap for the REST lobby surface. Tiles are excluded by
  // ordering — map pans legitimately burst dozens of requests.
  app.use('/api', rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  const io = new IOServer(server, {
    cors: { origin: corsOrigin, credentials: false },
  });

  const reg = registry || new RoomRegistry(io);
  if (typeof reg.init === 'function') await reg.init();

  // ---- REST: lobby --------------------------------------------------------

  app.get('/api/rooms', async (_req, res) => {
    const rooms = await reg.list();
    res.json({ rooms });
  });

  app.get('/api/leaderboard', async (req, res) => {
    const limit = Math.min(
      100, Math.max(1, parseInt(req.query.limit, 10) || 25)
    );
    const gameType = req.query.gameType || undefined;
    const top = await leaderboard.top(limit, { gameType });
    res.json({ top });
  });

  // Room creation is unauthenticated — keep a tighter cap on the one
  // write endpoint so it can't be spammed into thousands of rooms.
  const roomCreateLimiter = rateLimit({
    windowMs: 10 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'room-create rate limit exceeded, try later' },
  });
  app.post('/api/rooms', roomCreateLimiter, async (req, res) => {
    try {
      const room = await reg.create({
        name: req.body?.name,
        hostId: null,
        centerLat: req.body?.centerLat,
        centerLng: req.body?.centerLng,
        maxPlayers: req.body?.maxPlayers,
      });
      res.status(201).json({ room });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Static client build (optional) -------------------------------------
  // The server image bundles the SPA built without VITE_SERVER_URL, so
  // the Cloud Run URL doubles as a fallback entry point (same-origin
  // socket + /api, no CORS needed). No build dir → API-only server.
  const distDir = clientDist && path.resolve(clientDist);
  if (distDir && fs.existsSync(distDir)) {
    const indexHtml = path.join(distDir, 'index.html');
    app.use(express.static(distDir, {
      setHeaders(res, filePath) {
        const rel = path.relative(distDir, filePath)
          .split(path.sep).join('/');
        if (rel.startsWith('assets/')) {
          // Vite output is content-hashed — safe to cache forever.
          res.setHeader('Cache-Control', CACHE_IMMUTABLE);
        } else if (
          rel === 'index.html' || rel === 'sw.js' ||
          /^workbox-.*\.js$/.test(rel)
        ) {
          // Entry point + service worker must revalidate every load.
          res.setHeader('Cache-Control', CACHE_NO_STORE);
        } else if (rel === 'manifest.webmanifest') {
          res.setHeader('Cache-Control', CACHE_MANIFEST);
        }
      },
    }));
    // SPA fallback for client-side routes. Registered LAST and GET-only
    // so /api/*, /health and /socket.io always win; unmatched /api
    // paths get Express's 404, never index.html. (`/*splat` is the
    // Express 5 named wildcard — `*` alone is invalid.)
    app.get('/*splat', (req, res, next) => {
      if (
        req.path.startsWith('/api/') ||
        req.path.startsWith('/socket.io/')
      ) {
        return next();
      }
      res.setHeader('Cache-Control', CACHE_NO_STORE);
      res.sendFile(indexHtml);
    });
  }

  // ---- Socket: gameplay + lobby ------------------------------------------

  registerSocketHandlers(io, reg);

  return { app, server, io, registry: reg };
}
