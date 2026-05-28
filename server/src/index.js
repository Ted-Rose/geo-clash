// Geo Clash server entrypoint.
// Express for /health + /api/rooms; Socket.io for realtime room events.

import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as IOServer } from 'socket.io';
import { RoomRegistry } from './roomRegistry.js';
import { registerSocketHandlers } from './socketHandlers.js';
import { leaderboardStore } from './memoryStore.js';

const PORT = process.env.PORT || 3001;

// CORS_ORIGIN parsing:
//   - unset / empty / "*"         → allow any origin (reflect)
//   - "a,b,c"                     → allow exactly those origins
//   - single value                → allow that one origin
function parseCorsOrigin(raw) {
  if (!raw || raw.trim() === '' || raw.trim() === '*') return true;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length === 1 ? list[0] : list;
}
const CORS_ORIGIN = parseCorsOrigin(process.env.CORS_ORIGIN);
console.log('[geo-clash] CORS origin:', CORS_ORIGIN);

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: CORS_ORIGIN, credentials: false },
});

const registry = new RoomRegistry(io);

// ---- REST: lobby --------------------------------------------------------

app.get('/api/rooms', async (_req, res) => {
  const rooms = await registry.list();
  res.json({ rooms });
});

app.get('/api/leaderboard', async (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const top = await leaderboardStore.top(limit);
  res.json({ top });
});

app.post('/api/rooms', async (req, res) => {
  try {
    const room = await registry.create({
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

registerSocketHandlers(io, registry);

server.listen(PORT, () => {
  console.log(`[geo-clash] server listening on :${PORT}`);
});
