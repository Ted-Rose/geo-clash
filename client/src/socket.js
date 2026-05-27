import { io } from 'socket.io-client';

// Same-origin in dev (vite proxy) and prod (server can host static).
export const socket = io('/', { autoConnect: true, transports: ['websocket', 'polling'] });
