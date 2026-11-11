import '@testing-library/jest-dom/vitest';

// RTL's act() checks this flag before wrapping updates.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Node ≥22 exposes a stub `localStorage` global that shadows jsdom's real
// implementation (its methods are missing unless --localstorage-file is
// passed). Replace it with a minimal in-memory Storage so app code and tests
// behave the same as in a browser.
if (typeof globalThis.localStorage?.setItem !== 'function') {
  const store = new Map();
  const memoryStorage = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => void store.set(String(k), String(v)),
    removeItem: (k) => void store.delete(String(k)),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
}
