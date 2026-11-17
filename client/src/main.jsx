import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorFallback from './shared/ErrorFallback.jsx';
import { initSentry, ErrorBoundary } from './sentry.js';
import 'leaflet/dist/leaflet.css';
import './index.css';

// initSentry must resolve before render so the ErrorBoundary is
// Sentry-backed from the first paint. The SDK lazy-loads inside
// initSentry only when VITE_SENTRY_DSN is set (~75KB never ships to
// DSN-free builds); without a DSN it resolves immediately and the
// boundary is a passthrough. An async bootstrap is used instead of
// top-level await so the default Vite build target stays valid.
async function bootstrap() {
  await initSentry();
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary fallback={<ErrorFallback />}>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}

bootstrap();
