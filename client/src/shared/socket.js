import { io } from 'socket.io-client';

// In dev, Vite proxies /socket.io to the local server, so '/' is correct.
// In production, Vercel-hosted builds set VITE_SERVER_URL at build time to
// the Cloud Run HTTPS URL; the bundle baked into the server image leaves it
// unset and talks to the Cloud Run origin that served it (same-origin).
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || '/';

// API_BASE is used for fetch() and Leaflet tile URLs.
// If SERVER_URL is '/', we want empty string so '/api' stays relative.
// If SERVER_URL is 'https://...', we use it as the base.
export const API_BASE = SERVER_URL === '/' ? '' : SERVER_URL;

if (import.meta.env.PROD && SERVER_URL === '/') {
  // Same-origin production is legitimate: the backend serves this build
  // (see server/src/app.js). On Vercel it means VITE_SERVER_URL was
  // forgotten — the info log names both cases without crying wolf.
  console.info(
    '[geo-clash] VITE_SERVER_URL is unset — socket.io and /api will use ' +
      'the serving origin. Expected when the backend serves this build; ' +
      'on Vercel, set VITE_SERVER_URL to the Cloud Run URL.'
  );
}

export function getSessionId() {
  let id = sessionStorage.getItem('geo-clash-session');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('geo-clash-session', id);
  }
  return id;
}

let socketInstance = null;
export function getSocket() {
  if (!socketInstance) {
    socketInstance = io(SERVER_URL, {
      autoConnect: true,
      transports: ['websocket', 'polling'],
    });
  }
  return socketInstance;
}
