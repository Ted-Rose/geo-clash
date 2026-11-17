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
  captureStoreOrInternalError,
  guardSocketHandler,
  isStoreError,
  _resetForTests,
  _throttleKeyCount,
  _MAX_THROTTLE_KEYS,
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

test('distinct messages with the same error name still throttle',
  async (t) => {
    const recorded = [];
    cleanup(t, recorded);
    initWithRecorder(recorded);

    // Throttle keys are built from err.name — variable message text
    // must not bypass the throttle (and must not grow the key map).
    const handler = guardSocketHandler(async (msg) => {
      throw new TypeError(msg);
    }, { event: 'tick' });
    await handler('message one');
    await handler('a different message');
    await settle(recorded);
    await settle(recorded, 2, 150);
    assert.equal(recorded.length, 1,
      'same name + event throttles across message text');

    // A different error name is a different failure — still sends.
    const rangeHandler = guardSocketHandler(async () => {
      throw new RangeError('out of bounds');
    }, { event: 'tick' });
    await rangeHandler();
    await settle(recorded, 2);
    assert.equal(recorded.length, 2);
  }
);

test('the throttle map stays bounded under unbounded keys', (t) => {
  cleanup(t);
  for (let i = 0; i < _MAX_THROTTLE_KEYS + 25; i += 1) {
    captureInternalError(
      new Error('x'), {}, { throttleKey: `flood-${i}` }
    );
  }
  assert.equal(_throttleKeyCount(), _MAX_THROTTLE_KEYS);
});

test('expired throttle keys are evicted on access', (t) => {
  cleanup(t);
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  captureInternalError(new Error('x'), {}, { throttleKey: 'old' });
  assert.equal(_throttleKeyCount(), 1);
  t.mock.timers.tick(61_000); // past _THROTTLE_MS (60s)
  captureInternalError(new Error('x'), {}, { throttleKey: 'new' });
  assert.equal(_throttleKeyCount(), 1,
    'the expired key was evicted instead of accumulating');
});

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

test('guardSocketHandler routes store failures to warning store_error',
  async (t) => {
    const recorded = [];
    cleanup(t, recorded);
    initWithRecorder(recorded);

    // ioredis marks outage failures by name — a Valkey outage through
    // a socket handler is routine noise, not an error-queue bug.
    const err = new Error('Command aborted due to connection close');
    err.name = 'AbortError';
    const handler = guardSocketHandler(async () => { throw err; },
      { event: 'room-join' });
    await handler();
    await settle(recorded);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].level, 'warning');
    assert.equal(recorded[0].tags.error_code, 'store_error');
    assert.equal(recorded[0].tags.event, 'room-join');

    // Same name + event → throttled like internal errors.
    await handler();
    await settle(recorded, 2, 150);
    assert.equal(recorded.length, 1);
  }
);

test('guardSocketHandler classifies "Connection is closed." as store noise',
  async (t) => {
    const recorded = [];
    cleanup(t, recorded);
    initWithRecorder(recorded);

    // ioredis flushes pending commands with a plain Error.
    const err = new Error('Connection is closed.');
    const handler = guardSocketHandler(async () => { throw err; },
      { event: 'rooms-list' });
    await handler();
    await settle(recorded);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].level, 'warning');
    assert.equal(recorded[0].tags.error_code, 'store_error');
  }
);

test('isStoreError matches raw socket/TLS errors ioredis flushes',
  (t) => {
    cleanup(t);
    // During a rolling outage ioredis retries forever and flushes
    // command queues with the *raw* Node socket error — a plain
    // Error with an OS-level err.code, no ioredis error class.
    for (const code of [
      'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
      'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
    ]) {
      const e = new Error(`connect ${code}`);
      e.code = code;
      assert.equal(isStoreError(e), true, `${code} is store noise`);
    }
    // TLS handshake abort: no err.code, stable message prefix.
    const tls = new Error(
      'Client network socket disconnected before secure TLS ' +
      'connection was established'
    );
    assert.equal(isStoreError(tls), true);

    // The code match is gated on a plain Error name — a custom
    // error class carrying a .code is still a bug.
    const typed = new TypeError('connect ECONNRESET');
    typed.code = 'ECONNRESET';
    assert.equal(isStoreError(typed), false);
    // An unknown code on a plain Error is not store noise either.
    const weird = new Error('something else');
    weird.code = 'EISDIR';
    assert.equal(isStoreError(weird), false);
  }
);

test('guardSocketHandler routes a raw socket error to warning store_error',
  async (t) => {
    const recorded = [];
    cleanup(t, recorded);
    initWithRecorder(recorded);

    const err = new Error('read ECONNRESET');
    err.code = 'ECONNRESET';
    const handler = guardSocketHandler(async () => { throw err; },
      { event: 'location-update' });
    await handler();
    await settle(recorded);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].level, 'warning');
    assert.equal(recorded[0].tags.error_code, 'store_error');
    assert.equal(recorded[0].tags.event, 'location-update');
  }
);

test('captureStoreOrInternalError splits store noise from bugs',
  async (t) => {
    const recorded = [];
    cleanup(t, recorded);
    initWithRecorder(recorded);

    const storeErr = new Error('read ECONNRESET');
    storeErr.code = 'ECONNRESET';
    assert.equal(
      captureStoreOrInternalError(storeErr, { roomId: 'r1' }),
      true
    );
    const bug = new TypeError('undefined is not a function');
    assert.equal(
      captureStoreOrInternalError(bug, { roomId: 'r1' }),
      true
    );
    await settle(recorded, 2);
    assert.equal(recorded.length, 2);
    assert.equal(recorded[0].level, 'warning');
    assert.equal(recorded[0].tags.error_code, 'store_error');
    assert.equal(recorded[1].level, 'error');
    assert.equal(recorded[1].tags.error_code, 'internal_error');
  }
);

test('isStoreError keeps lookalikes and real bugs at error level', (t) => {
  cleanup(t);
  // Name must match exactly — a TypeError with the same message is
  // still a bug.
  assert.equal(
    isStoreError(new TypeError('Connection is closed.')), false
  );
  assert.equal(isStoreError(new Error('room-full')), false);
  assert.equal(isStoreError(null), false);
  assert.equal(isStoreError(undefined), false);
  // The store answered — command/schema bug, not an outage.
  const reply = new Error('WRONGTYPE bad key');
  reply.name = 'ReplyError';
  assert.equal(isStoreError(reply), false);
  // Lock contention is our own error class — stays internal.
  const lockErr = new Error('lock timeout: x');
  lockErr.name = 'LockTimeoutError';
  assert.equal(isStoreError(lockErr), false);
  // ioredis outage names all classify as store noise.
  for (const name of [
    'AbortError', 'InterruptError', 'MaxRetriesPerRequestError',
    'ClusterAllFailedError', 'RedisError',
  ]) {
    const e = new Error('x');
    e.name = name;
    assert.equal(isStoreError(e), true, `${name} is store noise`);
  }
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
