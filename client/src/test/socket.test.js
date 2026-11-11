import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ioSpy = vi.hoisted(() =>
  vi.fn(() => ({ id: 'fake-sock', connected: false, on() {}, off() {} }))
);
vi.mock('socket.io-client', () => ({ io: ioSpy }));

// socket.js keeps module-level state (the singleton + sessionStorage reads),
// so every test re-imports it fresh via vi.resetModules().
async function importSocket() {
  vi.resetModules();
  return await import('../shared/socket.js');
}

function randomUUIDSpy() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return vi.spyOn(crypto, 'randomUUID');
  }
  const fn = vi.fn(() => 'stubbed-uuid');
  vi.stubGlobal('crypto', { randomUUID: fn });
  return fn;
}

beforeEach(() => {
  sessionStorage.clear();
  ioSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getSessionId', () => {
  it('returns the same id across calls and persists to sessionStorage', async () => {
    const uuid = randomUUIDSpy().mockReturnValue('uuid-1');
    const { getSessionId } = await importSocket();
    const a = getSessionId();
    const b = getSessionId();
    expect(a).toBe('uuid-1');
    expect(b).toBe(a);
    expect(sessionStorage.getItem('geo-clash-session')).toBe('uuid-1');
    expect(uuid).toHaveBeenCalledTimes(1);
  });

  it('returns a pre-seeded sessionStorage value without calling randomUUID', async () => {
    const uuid = randomUUIDSpy();
    sessionStorage.setItem('geo-clash-session', 'seed-id');
    const { getSessionId } = await importSocket();
    expect(getSessionId()).toBe('seed-id');
    expect(uuid).not.toHaveBeenCalled();
  });
});

describe('SERVER_URL / API_BASE', () => {
  it("is '/' and '' when VITE_SERVER_URL is unset", async () => {
    vi.stubEnv('VITE_SERVER_URL', undefined);
    const { SERVER_URL, API_BASE } = await importSocket();
    expect(SERVER_URL).toBe('/');
    expect(API_BASE).toBe('');
  });

  it('API_BASE equals VITE_SERVER_URL when set', async () => {
    vi.stubEnv('VITE_SERVER_URL', 'https://x.example');
    const { SERVER_URL, API_BASE } = await importSocket();
    expect(SERVER_URL).toBe('https://x.example');
    expect(API_BASE).toBe('https://x.example');
  });
});

describe('getSocket', () => {
  it('returns a singleton and passes websocket+polling transports', async () => {
    const { getSocket } = await importSocket();
    const s1 = getSocket();
    const s2 = getSocket();
    expect(s1).toBe(s2);
    expect(ioSpy).toHaveBeenCalledTimes(1);
    expect(ioSpy).toHaveBeenCalledWith('/', {
      autoConnect: true,
      transports: ['websocket', 'polling'],
    });
  });
});
