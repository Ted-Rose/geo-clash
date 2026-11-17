// Sentry error reporting for the Geo Clash client.
//
// Same split as the server: real bugs (render crashes, unexpected
// caught errors) report at `error` level; routine network noise
// (server unreachable, a failed REST poll) is a warning or a
// breadcrumb — never the error queue. Everything is DSN-gated:
// no VITE_SENTRY_DSN → no init, and the helpers below are cheap
// no-ops, so dev machines and Vercel previews without the var stay
// Sentry-free.
//
// The SDK itself is lazy-loaded: a static `import '@sentry/react'`
// would pull a few hundred KB into the main chunk and evaluate it
// on every load (sentry.js is statically imported by App.jsx and
// friends).
// Instead initSentry dynamic-imports the SDK and stashes the
// namespace on `_Sentry`; helpers consult that ref and no-op until
// it arrives. The dynamic import still emits a separate chunk the
// service worker precaches — DSN-free clients download it once but
// it is never parsed or executed.

import { createElement } from 'react';

let _Sentry = null;

// Error codes worth trending as warnings. Anything else passed to
// captureExpectedError stays local.
const _EXPECTED_CODES = new Set([
  'connect_error', // socket.io handshake/transport failures
]);

// Initialize the SDK. No VITE_SENTRY_DSN → resolves false without
// ever importing @sentry/react (its precached chunk simply never
// executes). `options` exists so tests can inject a DSN and a
// `beforeSend` spy that records (and drops) events; `_sdkLoader`
// lets tests simulate a failed chunk fetch or a throwing init.
// Environment comes from VITE_SENTRY_ENVIRONMENT when set — Vite
// builds always emit MODE=production, so the staging SPA needs the
// explicit var to stop reporting itself as production.
//
// Never rejects: a failed chunk fetch (flaky link, mid-deploy
// precache race) or a throwing Sentry.init leaves _Sentry null so
// the ErrorBoundary stays a passthrough and the app still renders.
export async function initSentry({
  dsn = import.meta.env.VITE_SENTRY_DSN,
  environment =
    import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
  beforeSend,
  transport,
  _sdkLoader = () => import('@sentry/react'),
} = {}) {
  if (!dsn) return false;
  try {
    _Sentry = await _sdkLoader();
    _Sentry.init({
      dsn,
      environment,
      ...(beforeSend ? { beforeSend } : {}),
      ...(transport ? { transport } : {}),
    });
  } catch (err) {
    _Sentry = null;
    console.warn('[sentry] init failed, reporting disabled:', err);
    return false;
  }
  return true;
}

// Error boundary for the app root. Sentry-backed once initSentry has
// loaded the SDK (main.jsx awaits it before render); a transparent
// passthrough when it never ran — without a DSN nothing would be
// reported anyway. (createElement, not JSX: this is a .js module.)
export function ErrorBoundary({ fallback, children }) {
  if (!_Sentry) return children;
  return createElement(_Sentry.ErrorBoundary, { fallback }, children);
}

function _capture(err, level, tags) {
  if (!err || !_Sentry?.getClient()) return false;
  _Sentry.withScope((scope) => {
    scope.setLevel(level);
    for (const [k, v] of Object.entries(tags || {})) {
      if (v !== undefined) scope.setTag(k, v);
    }
    _Sentry.captureException(err);
  });
  return true;
}

// Report a real bug caught by app code — a caught-but-unexpected
// failure. Captured at error level under
// `error_code: internal_error` (overridable via tags).
// NB: captureInternalError/captureExpectedError have no app-code
// callers yet — kept for parity with the server helper surface.
export function captureInternalError(err, tags = {}) {
  return _capture(err, 'error', { error_code: 'internal_error', ...tags });
}

// Report routine expected failures for trending. Only allowlisted
// `errorCode`s are sent, at warning level.
export function captureExpectedError(err, { errorCode, ...tags } = {}) {
  if (!_EXPECTED_CODES.has(errorCode)) return false;
  return _capture(err, 'warning', { error_code: errorCode, ...tags });
}

// Leave a breadcrumb for routine events that are useful context on a
// real error but not worth an issue of their own (reconnects, a
// skipped leaderboard refresh). No-op without a client.
export function sentryBreadcrumb(message, data = {}) {
  if (!_Sentry?.getClient()) return false;
  _Sentry.addBreadcrumb({ message, data, level: 'info' });
  return true;
}

// Reset module state — tests only.
export function _resetForTests() {
  _Sentry = null;
}
