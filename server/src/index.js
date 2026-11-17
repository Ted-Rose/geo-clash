// Geo Clash server entrypoint.
// Express for /health + /api/rooms; Socket.io for realtime room events.

// Sentry must init before express/socket.io load so the SDK's module
// hooks can instrument them; the dynamic imports keep that ordering
// explicit (static imports would all resolve before any code ran).
// No SENTRY_DSN → initSentry no-ops and every capture call drops.
const { initSentry } = await import('./sentry.js');
initSentry();
const { buildServer, parseCorsOrigin } = await import('./app.js');

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
