import { io } from 'socket.io-client';

// In dev, Vite proxies /socket.io to the local server, so '/' is correct.
// In production (Vercel SPA + GCP Cloud Run server), VITE_SERVER_URL must be
// set at build time to the Cloud Run HTTPS URL — otherwise socket.io connects
// to the Vercel origin, hits the SPA rewrite, and silently never handshakes.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || '/';

if (import.meta.env.PROD && SERVER_URL === '/') {
  // eslint-disable-next-line no-console
  console.warn(
    '[geo-clash] VITE_SERVER_URL is not set for the production build. ' +
      'Socket.io will try to connect to the Vercel origin and fail silently. ' +
      'Set VITE_SERVER_URL to your Cloud Run URL in the Vercel project env.'
  );
}

export const socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
});
