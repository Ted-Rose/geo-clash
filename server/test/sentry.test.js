// Tests for the Sentry helpers in src/sentry.js: the DSN gate, the
// internal/expected capture split, the allowlist, throttling, and the
// socket-handler guard. Events are recorded via an injected
// beforeSend that returns null, plus a no-op transport — nothing
// leaves the test process.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as Sentry from '@sentry/node';
import {
  initSentry,
  captureInternalError,
  captureExpectedError,
  guardSocketHandler,
  _resetForTests,
} from '../src/sentry.js';

const FAKE_DSN = 'https://public@o123.ingest.us.sentry.io/456';

// Sentry constructs the transport via `new`; a function returning an
// object survives that (constructor return value wins).
function noopTransport() {
  return { send: async () => ({}), flush: async () => true };
}

function initWithRecorder(recorded) {
  return initSentry({
    dsn: FAKE_DSN,
    environment: 'test',
    transport: noopTransport,
    beforeSend: (event) => {
      recorded.push(event);
      return null; // drop — never hits the transport
    },
  });
}

// The SDK's event pipeline (beforeSend included) runs async — poll
// until `recorded` reaches `n` events instead of sleeping a fixed
// amount. Negative assertions wait `timeoutMs` for an event that
// should never arrive.
async function settle(recorded, n = 1, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (recorded.length < n && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

function cleanup(t, recorded) {
  t.after(async () => {
    _resetForTests();
    if (recorded) recorded.length = 0;
    await Sentry.close();
  });
}

test('initSentry returns false with no DSN; helpers no-op', async (t) => {
  cleanup(t);
  assert.equal(initSentry({ dsn: '' }), false);
  assert.equal(
    captureInternalError(new Error('x'), { event: 'e' }), false
  );
  assert.equal(
    captureExpectedError(new Error('x'), { errorCode: 'store_error' }),
    false
  );
  const handler = guardSocketHandler(async () => 'ok');
  assert.equal(await handler(), 'ok');
});

test('captureInternalError sends error-level tagged events', async (t) => {
  const recorded = [];
  cleanup(t, recorded);
  assert.equal(initWithRecorder(recorded), true);

  const err = new Error('boom');
  assert.equal(captureInternalError(err, { event: 'tick' }), true);
  await settle(recorded);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].level, 'error');
  assert.equal(recorded[0].tags.error_code, 'internal_error');
  assert.equal(recorded[0].tags.event, 'tick');
});

test('captureExpectedError sends only allowlisted codes, at warning',
  async (t) => {
    const recorded = [];
    cleanup(t, recorded);
    initWithRecorder(recorded);

    assert.equal(
      captureExpectedError(new Error('redis down'),
        { errorCode: 'store_error' }),
      true
    );
    await settle(recorded);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].level, 'warning');
    assert.equal(recorded[0].tags.error_code, 'store_error');

    // Routine outcomes stay local — no event, false return.
    assert.equal(
      captureExpectedError(new Error('typo'),
        { errorCode: 'not_found' }),
      false
    );
    await settle(recorded, 2, 150);
    assert.equal(recorded.length, 1);
  }
);

test('repeated captures with the same throttleKey are dropped',
  async (t) => {
    const recorded = [];
    cleanup(t, recorded);
    initWithRecorder(recorded);

    const first = captureInternalError(
      new Error('same'), {}, { throttleKey: 'k1' }
    );
    const second = captureInternalError(
      new Error('same'), {}, { throttleKey: 'k1' }
    );
    const third = captureInternalError(
      new Error('same'), {}, { throttleKey: 'k2' }
    );
    assert.equal(first, true);
    assert.equal(second, false, 'throttled within the window');
    assert.equal(third, true, 'a different key still sends');
    await settle(recorded, 2);
    assert.equal(recorded.length, 2);
  }
);

test('guardSocketHandler captures a throw and swallows it', async (t) => {
  const recorded = [];
  cleanup(t, recorded);
  initWithRecorder(recorded);

  const boom = new Error('handler exploded');
  const handler = guardSocketHandler(
    async () => { throw boom; },
    { event: 'location-update' }
  );
  const result = await handler({ lat: 1 });
  assert.equal(result, undefined, 'the error never propagates');
  await settle(recorded);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].level, 'error');
  assert.equal(recorded[0].tags.event, 'location-update');
});

test('guardSocketHandler passes return values through', async (t) => {
  const recorded = [];
  cleanup(t, recorded);
  initWithRecorder(recorded);

  const handler = guardSocketHandler(async (v) => v * 2, {});
  assert.equal(await handler(21), 42);
  await settle(recorded, 1, 150);
  assert.equal(recorded.length, 0);
});

test('beforeSend strips credential-shaped request headers', async (t) => {
  const recorded = [];
  cleanup(t, recorded);
  initWithRecorder(recorded);

  // Push a request-bearing event through the real pipeline — the
  // recorder sees the post-scrub payload.
  Sentry.captureEvent({
    message: 'http bug',
    request: {
      headers: {
        Cookie: 'session=secret',
        Authorization: 'Bearer secret',
        'X-Api-Key': 'secret',
        'Content-Type': 'application/json',
      },
    },
  });
  await settle(recorded);
  assert.equal(recorded.length, 1);
  const headers = recorded[0].request.headers;
  assert.equal(headers.Cookie, '[Filtered]');
  assert.equal(headers.Authorization, '[Filtered]');
  assert.equal(headers['X-Api-Key'], '[Filtered]');
  assert.equal(headers['Content-Type'], 'application/json');
});
