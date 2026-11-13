import process from 'node:process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Injects <link rel="preconnect"> to the Cloud Run origin so the
// cross-origin socket.io handshake starts sooner. Only emitted when
// VITE_SERVER_URL is set — in dev everything is same-origin via the
// proxy below, so a literal %VITE_SERVER_URL% placeholder is never left
// in the HTML.
function serverPreconnect(serverUrl) {
  return {
    name: 'server-preconnect',
    transformIndexHtml(html) {
      if (!serverUrl) return html;
      return html.replace(
        '</head>',
        `    <link rel="preconnect" href="${serverUrl}" crossorigin />\n` +
          `    <link rel="dns-prefetch" href="${serverUrl}" />\n  </head>`
      );
    },
  };
}

// During dev we proxy Socket.io traffic to the Node server so the phone
// only needs to know one origin (e.g. http://192.168.x.x:5173).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      serverPreconnect(env.VITE_SERVER_URL),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: [
          'favicon.svg',
          'favicon.ico',
          'apple-touch-icon-180x180.png',
        ],
        manifest: {
          name: 'Parku Cīņas',
          short_name: 'Parku Cīņas',
          description:
            'Real-time multiplayer territory game on real-world maps',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'portrait',
          scope: '/',
          start_url: '/',
          icons: [
            {
              src: 'pwa-64x64.png',
              sizes: '64x64',
              type: 'image/png',
            },
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'maskable-icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
          navigateFallback: 'index.html',
          // /api (tile proxy) and socket.io are routed off-origin; the
          // SPA fallback must not swallow navigations to them.
          navigateFallbackDenylist: [/^\/socket\.io/, /^\/api\//],
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              // Serialized verbatim into sw.js — must not close over
              // config-scope names. `sameOrigin` guards cross-origin
              // tile responses out of this cache; RegExp urlPatterns
              // can't anchor a bare path (they test url.href), hence
              // a match callback.
              urlPattern: ({ url, sameOrigin }) =>
                sameOrigin && url.pathname.startsWith('/api/map/tiles/'),
              // Satellite imagery is effectively immutable and the edge
              // already serves cached copies — cache first. Offline
              // coverage = whatever areas were viewed while online.
              handler: 'CacheFirst',
              options: {
                cacheName: 'map-tiles',
                expiration: {
                  // ~256px JPEGs (~30-60 KB each): 2000 entries covers
                  // several arenas at all zooms (~100 MB worst case).
                  maxEntries: 2000,
                  maxAgeSeconds: 30 * 24 * 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        '/socket.io': {
          target: 'http://localhost:3001',
          ws: true,
          changeOrigin: true,
        },
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  };
});
