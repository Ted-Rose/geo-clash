// Geo Clash server entrypoint.
// Express for /health + /api/rooms; Socket.io for realtime room events.

import { buildServer, parseCorsOrigin } from './app.js';

const PORT = process.env.PORT || 3001;

const corsOrigin = parseCorsOrigin(process.env.CORS_ORIGIN);
console.log(
  '[geo-clash] CORS origin:',
  corsOrigin === false ? '(same-origin only)' : corsOrigin
);

const { server } = await buildServer({ corsOrigin });

server.listen(PORT, () => {
  console.log(`[geo-clash] server listening on :${PORT}`);
});
