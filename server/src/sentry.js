// Sentry error reporting for the Geo Clash server.
//
// Design mirrors the split used in the bible_research API:
//   - real bugs (uncaught exceptions, caught-but-unexpected failures)
//     are captured at `error` level so `is:unresolved level:error`
//     stays an actionable queue,
//   - routine upstream/infrastructure noise (Valkey outages, the Esri
//     tile source failing) is captured at `warning` level for trending,
//     behind an allowlist of error codes,
//   - expected gameplay outcomes (validation rejects, missing rooms,
//     rate-limit acks) never leave the process at all.
//
// Everything is DSN-gated: no SENTRY_DSN means zero Sentry traffic and
// every helper below is a cheap no-op (captureException drops events
// when the SDK has no client), so a fresh laptop runs untouched.

import * as Sentry from '@sentry/node';

// Error codes worth trending as warnings. Anything else passed to
// captureExpectedError stays local — expected errors must not dilute
// the error-level queue.
const _EXPECTED_CODES = new Set([
  'store_error',          // Valkey/store connection + command failures
  'upstream_tile_error',  // Esri metadata/tile fetch failures
]);

// Error names ioredis / redis-errors reject commands with when the
// store is unreachable — connection-close aborts, offline-queue
// aborts, retry-cap flushes. These are outages, not code bugs, so
// callers route them to warning-level `store_error` instead of the
// error queue. ReplyError and ParserError are absent on purpose: a
// server-side reply or protocol error means the store *answered* —
// that smells like a schema/command bug, not an outage.
const _STORE_ERROR_NAMES = new Set([
  'AbortError',                // command aborted on connection close
  'InterruptError',            // aborted by disconnect()
  'MaxRetriesPerRequestError', // offline-queue retry cap hit
  'ClusterAllFailedError',     // no cluster node reachable
  'RedisError',                // generic connection discarded/aborted
]);

// ioredis also flushes pending commands with a *plain* Error carrying
// this exact message when the socket ends mid-flight.
const _CONNECTION_CLOSED_MSG = 'Connection is closed.';

// True when `err` looks like a store/Valkey failure (see the name
// table above) rather than a bug in the calling code. Used to keep a
// Valkey outage from flooding the error-level fix queue with routine
// store failures through socket handlers.
export function isStoreError(err) {
  if (!err || typeof err !== 'object') return false;
  if (_STORE_ERROR_NAMES.has(err.name)) return true;
  return err.name === 'Error' && err.message === _CONNECTION_CLOSED_MSG;
}

// Minimum interval between two captures sharing the same throttle key.
// Keeps a persistently failing 200 ms tick loop from flooding the
// project quota — Sentry still groups the first occurrence.
const _THROTTLE_MS = 60_000;
// Hard cap on distinct keys held at once. Callers must key on stable
// context + err.name (never err.message — variable message text would
// mint a new key per error and silently bypass the throttle); this
// bound is the backstop for a caller that still mints unbounded keys.
export const _MAX_THROTTLE_KEYS = 1_000;
const _lastSent = new Map();

// Initialize the SDK. No SENTRY_DSN → returns false and the process
// stays Sentry-free. `options` exists so tests can inject a DSN, a
// `beforeSend` spy that records (and drops) events, and a no-op
// `transport` so nothing leaves the test process.
export function initSentry({
  dsn = process.env.SENTRY_DSN,
  environment = process.env.NODE_ENV || 'development',
  beforeSend,
  transport,
} = {}) {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment,
    ...(transport ? { transport } : {}),
    // Socket events carry player names + coordinates; request headers
    // can carry anything a client sends. Strip credential-shaped
    // headers so they never reach Sentry.
    beforeSend(event, hint) {
      const headers = event.request?.headers;
      if (headers) {
        for (const name of Object.keys(headers)) {
          const lowered = name.toLowerCase();
          if (
            lowered === 'authorization' ||
            lowered === 'cookie' ||
            lowered === 'x-api-key'
          ) {
            headers[name] = '[Filtered]';
          }
        }
      }
      return beforeSend ? beforeSend(event, hint) : event;
    },
  });
  return true;
}

function _throttled(key) {
  if (!key) return false;
  const now = Date.now();
  const last = _lastSent.get(key);
  if (last !== undefined && now - last < _THROTTLE_MS) return true;
  // Drop expired keys — always the oldest prefix, since timestamps
  // are non-decreasing and re-sends re-insert at the tail.
  for (const [k, ts] of _lastSent) {
    if (now - ts < _THROTTLE_MS) break;
    _lastSent.delete(k);
  }
  // Then the hard cap — evict the oldest key until there's room.
  while (_lastSent.size >= _MAX_THROTTLE_KEYS) {
    _lastSent.delete(_lastSent.keys().next().value);
  }
  _lastSent.delete(key); // re-insert at the tail so order == ts order
  _lastSent.set(key, now);
  return false;
}

function _capture(err, level, tags, throttleKey) {
  if (!err) return false;
  if (_throttled(throttleKey)) return false;
  if (!Sentry.getClient()) return false;
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    for (const [k, v] of Object.entries(tags || {})) {
      if (v !== undefined) scope.setTag(k, v);
    }
    Sentry.captureException(err);
  });
  return true;
}

// Report a real bug caught by our own code: tick-loop failures, socket
// handler exceptions, store teardown errors — anything the process
// swallowed that a developer should see. Captured at error level under
// `error_code: internal_error` (overridable via tags).
export function captureInternalError(err, tags = {}, { throttleKey } = {}) {
  return _capture(err, 'error', { error_code: 'internal_error', ...tags },
    throttleKey);
}

// Report routine upstream/infrastructure noise for trending. Only
// allowlisted `errorCode`s are sent, at warning level — anything else
// returns false and stays local.
export function captureExpectedError(
  err, { errorCode, ...tags } = {}, { throttleKey } = {},
) {
  if (!_EXPECTED_CODES.has(errorCode)) return false;
  return _capture(err, 'warning', { error_code: errorCode, ...tags },
    throttleKey);
}

// Wrap a socket event handler so a throw/rejection is captured and
// swallowed instead of becoming an unhandled rejection that can kill
// the process (socket.io does not catch async handler failures).
// The handler's return value propagates unchanged on success.
export function guardSocketHandler(handler, { event } = {}) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error(`[socket] ${event} handler error:`, err.message);
      // Key on err.name, not err.message: message text varies per
      // error and would mint a new key each time, defeating the
      // throttle and growing _lastSent unboundedly.
      const throttleKey = `socket:${event}:${err.name}`;
      if (isStoreError(err)) {
        // A Valkey outage fails every store-touching handler the
        // same way — routine noise, trend it as a warning (same
        // class as the client's own 'error' listener reports).
        captureExpectedError(err, { errorCode: 'store_error', event },
          { throttleKey });
      } else {
        captureInternalError(err, { event }, { throttleKey });
      }
      return undefined;
    }
  };
}

// Reset module state — tests only.
export function _resetForTests() {
  _lastSent.clear();
}

// Throttle-map size — tests only.
export function _throttleKeyCount() {
  return _lastSent.size;
}
