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
          navigateFallbackDenylist: [/^\/socket\.io/],
          clientsClaim: true,
          skipWaiting: true,
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
