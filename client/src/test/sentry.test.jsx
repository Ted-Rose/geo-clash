// Tests for the Sentry helpers in src/sentry.js: the DSN gate, the
// internal/expected capture split, breadcrumbs, environment
// resolution, and the ErrorBoundary fallback. Events are recorded
// via an injected beforeSend that returns null, plus a no-op
// transport — nothing leaves the test process.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as Sentry from '@sentry/react';
import {
  initSentry,
  captureInternalError,
  captureExpectedError,
  sentryBreadcrumb,
  ErrorBoundary,
  _resetForTests,
} from '../sentry.js';
import ErrorFallback from '../shared/ErrorFallback.jsx';

const FAKE_DSN = 'https://public@o123.ingest.us.sentry.io/456';

// Sentry constructs the transport via `new`; a function returning an
// object survives that (constructor return value wins).
function noopTransport() {
  return { send: async () => ({}), flush: async () => true };
}

async function initWithRecorder(recorded) {
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
// amount. Negative assertions pass a short timeoutMs for an event
// that should never arrive.
async function settle(recorded, n = 1, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (recorded.length < n && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

afterEach(async () => {
  _resetForTests();
  await Sentry.close();
});

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe('initSentry', () => {
  it('returns false when VITE_SENTRY_DSN is unset', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    expect(await initSentry()).toBe(false);
    expect(captureInternalError(new Error('x'))).toBe(false);
    expect(sentryBreadcrumb('m')).toBe(false);
  });

  it('returns true when the DSN env var is set', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', FAKE_DSN);
    expect(await initSentry({ transport: noopTransport })).toBe(true);
  });

  it('prefers VITE_SENTRY_ENVIRONMENT over MODE', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', FAKE_DSN);
    vi.stubEnv('VITE_SENTRY_ENVIRONMENT', 'staging');
    await initSentry({ transport: noopTransport });
    expect(Sentry.getClient().getOptions().environment)
      .toBe('staging');
  });

  it('falls back to MODE when VITE_SENTRY_ENVIRONMENT is unset',
    async () => {
      vi.stubEnv('VITE_SENTRY_DSN', FAKE_DSN);
      await initSentry({ transport: noopTransport });
      // Vitest runs with MODE=test — the point is only that the
      // fallback is import.meta.env.MODE, not a hardcoded value.
      expect(Sentry.getClient().getOptions().environment)
        .toBe('test');
    }
  );

  it('stays a passthrough when the SDK chunk fails to load',
    async () => {
      // A rejected chunk fetch (flaky link, mid-deploy precache
      // race) must not take the app down: initSentry resolves
      // false, _Sentry stays null, the boundary is a passthrough.
      vi.stubEnv('VITE_SENTRY_DSN', FAKE_DSN);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const ok = await initSentry({
        _sdkLoader: () =>
          Promise.reject(new TypeError('Failed to fetch chunk')),
      });
      expect(ok).toBe(false);
      expect(captureInternalError(new Error('x'))).toBe(false);
      render(
        <ErrorBoundary fallback={<ErrorFallback />}>
          <div>the app</div>
        </ErrorBoundary>
      );
      expect(screen.getByText('the app')).toBeInTheDocument();
      console.warn.mockRestore();
    }
  );

  it('stays a passthrough when Sentry.init itself throws',
    async () => {
      vi.stubEnv('VITE_SENTRY_DSN', FAKE_DSN);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const ok = await initSentry({
        _sdkLoader: () => Promise.resolve({
          init: () => { throw new Error('bad options'); },
        }),
      });
      expect(ok).toBe(false);
      render(
        <ErrorBoundary fallback={<ErrorFallback />}>
          <div>the app</div>
        </ErrorBoundary>
      );
      expect(screen.getByText('the app')).toBeInTheDocument();
      console.warn.mockRestore();
    }
  );
});

describe('capture helpers', () => {
  it('captureInternalError sends error-level tagged events', async () => {
    const recorded = [];
    await initWithRecorder(recorded);
    expect(captureInternalError(new Error('boom'), { area: 'lobby' }))
      .toBe(true);
    await settle(recorded);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].level).toBe('error');
    expect(recorded[0].tags.error_code).toBe('internal_error');
    expect(recorded[0].tags.area).toBe('lobby');
  });

  it('captureExpectedError sends only allowlisted codes, at warning',
    async () => {
      const recorded = [];
      await initWithRecorder(recorded);
      expect(
        captureExpectedError(new Error('unreachable'),
          { errorCode: 'connect_error' })
      ).toBe(true);
      await settle(recorded);
      expect(recorded).toHaveLength(1);
      expect(recorded[0].level).toBe('warning');
      expect(recorded[0].tags.error_code).toBe('connect_error');

      expect(
        captureExpectedError(new Error('typo'),
          { errorCode: 'not_found' })
      ).toBe(false);
      await settle(recorded, 2, 150);
      expect(recorded).toHaveLength(1);
    }
  );

  it('sentryBreadcrumb attaches to the next captured event', async () => {
    const recorded = [];
    await initWithRecorder(recorded);
    expect(sentryBreadcrumb('socket connect_error', {
      message: 'xhr poll error',
    })).toBe(true);
    captureInternalError(new Error('boom'));
    await settle(recorded);
    const crumbs = recorded[0].breadcrumbs || [];
    expect(crumbs.some((b) => b.message === 'socket connect_error'))
      .toBe(true);
  });
});

describe('ErrorBoundary', () => {
  it('renders ErrorFallback and captures a render crash', async () => {
    const recorded = [];
    await initWithRecorder(recorded);
    // React logs the boundary hit noisily; silence for the test.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => { throw new Error('render exploded'); };
    render(
      <ErrorBoundary fallback={<ErrorFallback />}>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong'
    );
    expect(screen.getByRole('button', { name: 'Reload' }))
      .toBeInTheDocument();
    await settle(recorded);
    expect(recorded.length).toBeGreaterThanOrEqual(1);
    expect(recorded[0].level).toBe('error');
    console.error.mockRestore();
  });

  it('passes children through when the SDK was never loaded', () => {
    // _Sentry is null (afterEach reset) — no DSN build, no boundary.
    render(
      <ErrorBoundary fallback={<ErrorFallback />}>
        <div>the app</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('the app')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
