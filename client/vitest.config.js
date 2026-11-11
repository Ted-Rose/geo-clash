import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Test config is kept separate from vite.config.js so the PWA plugin and dev
// proxy settings stay out of the test path (and `vite build` never needs the
// vitest dependency installed).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // Leaflet CSS imports resolve to empty modules by default; keep it that way.
    css: false,
    // Non-opaque origin so localStorage/sessionStorage are usable in tests.
    environmentOptions: {
      jsdom: { url: 'http://localhost:5173/' },
    },
  },
});
