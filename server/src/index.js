// Geo Clash server entrypoint.
// Express for /health + static if ever needed; Socket.io for realtime.

import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as IOServer } from 'socket.io';
import { GameState } from './gameState.js';
import { registerSocketHandlers } from './socketHandlers.js';

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: true, credentials: false },
});

const game = new GameState(io);
registerSocketHandlers(io, game);

server.listen(PORT, () => {
  console.log(`[geo-clash] server listening on :${PORT}`);
});
