// Sentry error reporting for the Geo Clash client.
//
// Same split as the server: real bugs (render crashes, unexpected
// caught errors) report at `error` level; routine network noise
// (server unreachable, a failed REST poll) is a warning or a
// breadcrumb — never the error queue. Everything is DSN-gated:
// no VITE_SENTRY_DSN → no init, and the helpers below are cheap
// no-ops, so dev machines and Vercel previews without the var stay
// Sentry-free.

import * as Sentry from '@sentry/react';

// Error codes worth trending as warnings. Anything else passed to
// captureExpectedError stays local.
const _EXPECTED_CODES = new Set([
  'connect_error', // socket.io handshake/transport failures
]);

// Initialize the SDK. No VITE_SENTRY_DSN → returns false. `options`
// exists so tests can inject a DSN and a `beforeSend` spy that records
// (and drops) events.
export function initSentry({
  dsn = import.meta.env.VITE_SENTRY_DSN,
  environment = import.meta.env.MODE,
  beforeSend,
  transport,
} = {}) {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment,
    ...(beforeSend ? { beforeSend } : {}),
    ...(transport ? { transport } : {}),
  });
  return true;
}

function _capture(err, level, tags) {
  if (!err || !Sentry.getClient()) return false;
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    for (const [k, v] of Object.entries(tags || {})) {
      if (v !== undefined) scope.setTag(k, v);
    }
    Sentry.captureException(err);
  });
  return true;
}

// Report a real bug caught by app code — a caught-but-unexpected
// failure. Captured at error level under
// `error_code: internal_error` (overridable via tags).
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
  if (!Sentry.getClient()) return false;
  Sentry.addBreadcrumb({ message, data, level: 'info' });
  return true;
}
