import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During dev we proxy Socket.io traffic to the Node server so the phone
// only needs to know one origin (e.g. http://192.168.x.x:5173).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
