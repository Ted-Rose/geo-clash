// Express app + Socket.io wiring for Geo Clash. Extracted from index.js
// so tests can bind the HTTP surface to an ephemeral port without the
// entrypoint auto-listening.

import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as IOServer } from 'socket.io';
import { RoomRegistry } from './roomRegistry.js';
import { registerSocketHandlers } from './socketHandlers.js';
import { leaderboardStore } from './shared/memoryStore.js';
import tileProxy from './tileProxy.js';

// CORS_ORIGIN parsing:
//   - unset / empty / "*"         → allow any origin (reflect)
//   - "a,b,c"                     → allow exactly those origins
//   - single value                → allow that one origin
export function parseCorsOrigin(raw) {
  if (!raw || raw.trim() === '' || raw.trim() === '*') return true;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length === 1 ? list[0] : list;
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
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());
  app.use('/api/map/tiles', tileProxy);
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
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const gameType = req.query.gameType || undefined;
    const top = await leaderboard.top(limit, { gameType });
    res.json({ top });
  });

  app.post('/api/rooms', async (req, res) => {
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
