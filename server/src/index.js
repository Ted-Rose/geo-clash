// Geo Clash server entrypoint.
// Express for /health + static if ever needed; Socket.io for realtime.

import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as IOServer } from 'socket.io';
import { GameState } from './gameState.js';
import { registerSocketHandlers } from './socketHandlers.js';

const PORT = process.env.PORT || 3001;

// CORS_ORIGIN parsing:
//   - unset / empty / "*"         → allow any origin (reflect)
//   - "a,b,c"                     → allow exactly those origins
//   - single value                → allow that one origin
// Both Express and Socket.io use the same value.
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
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: CORS_ORIGIN, credentials: false },
});

const game = new GameState(io);
registerSocketHandlers(io, game);

server.listen(PORT, () => {
  console.log(`[geo-clash] server listening on :${PORT}`);
});
