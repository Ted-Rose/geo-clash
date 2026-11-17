import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App.jsx';
import ErrorFallback from './shared/ErrorFallback.jsx';
import { initSentry } from './sentry.js';
import 'leaflet/dist/leaflet.css';
import './index.css';

// No VITE_SENTRY_DSN → initSentry no-ops and the ErrorBoundary below
// still renders the fallback (capture calls drop without a client).
initSentry();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
