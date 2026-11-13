// Express app + Socket.io wiring for Geo Clash. Extracted from index.js
// so tests can bind the HTTP surface to an ephemeral port without the
// entrypoint auto-listening.

import http from 'http';
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

// Builds the express app, HTTP server, Socket.io server and room registry
// WITHOUT listening. `registry` and `leaderboard` are injectable so tests
// can stub failure paths and isolate leaderboard state.
export async function buildServer({
  corsOrigin = parseCorsOrigin(process.env.CORS_ORIGIN),
  registry,
  leaderboard = leaderboardStore,
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

  // ---- Socket: gameplay + lobby ------------------------------------------

  registerSocketHandlers(io, reg);

  return { app, server, io, registry: reg };
}
