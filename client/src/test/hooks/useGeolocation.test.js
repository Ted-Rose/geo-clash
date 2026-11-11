import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGeolocation } from '../../hooks/useGeolocation.js';

function stubGeolocation(overrides = {}) {
  const geo = {
    watchPosition: vi.fn(() => 42),
    clearWatch: vi.fn(),
    ...overrides,
  };
  Object.defineProperty(navigator, 'geolocation', {
    value: geo,
    configurable: true,
    writable: true,
  });
  return geo;
}

function fakePos({ lat, lng, heading = NaN, accuracy = 5 }) {
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy,
      heading,
    },
  };
}

afterEach(() => {
  // Leave the stub installed: mounted hooks call clearWatch during RTL's
  // auto-unmount, which runs after this hook.
  vi.restoreAllMocks();
});

describe('useGeolocation', () => {
  it('returns simulated position and never touches GPS', () => {
    const geo = stubGeolocation();
    const pos = { lat: 52.5, lng: 13.4, heading: 0 };
    const { result } = renderHook(() => useGeolocation({ simulated: pos }));
    expect(result.current.position).toEqual(pos);
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it('derives heading via bearing when coords.heading is null', () => {
    let onSuccess;
    stubGeolocation({
      watchPosition: vi.fn((ok) => {
        onSuccess = ok;
        return 7;
      }),
    });
    const { result } = renderHook(() => useGeolocation());

    // First fix: no previous position → heading stays null.
    act(() => onSuccess(fakePos({ lat: 0, lng: 0, heading: NaN })));
    expect(result.current.position.heading).toBeNull();

    // Second fix due north → bearing ≈ 0.
    act(() => onSuccess(fakePos({ lat: 0.001, lng: 0, heading: NaN })));
    expect(result.current.position.heading).toBeCloseTo(0, 1);

    // Third fix due east → bearing ≈ 90.
    act(() => onSuccess(fakePos({ lat: 0.001, lng: 0.001, heading: NaN })));
    expect(result.current.position.heading).toBeCloseTo(90, 1);
  });

  it('passes a finite coords.heading through without the fallback', () => {
    let onSuccess;
    stubGeolocation({
      watchPosition: vi.fn((ok) => {
        onSuccess = ok;
        return 7;
      }),
    });
    const { result } = renderHook(() => useGeolocation());
    act(() => onSuccess(fakePos({ lat: 0, lng: 0, heading: 123 })));
    // A moved second fix with a real heading should keep it verbatim.
    act(() => onSuccess(fakePos({ lat: 0, lng: 0.001, heading: 45 })));
    expect(result.current.position.heading).toBe(45);
  });

  it('reports unsupported when geolocation is absent', () => {
    delete navigator.geolocation;
    const { result } = renderHook(() => useGeolocation());
    expect(result.current.error).toBe('Geolocation not supported');
    expect(result.current.position).toBeNull();
  });

  it('clears the watch on unmount', () => {
    const geo = stubGeolocation({ watchPosition: vi.fn(() => 99) });
    const { unmount } = renderHook(() => useGeolocation());
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    unmount();
    expect(geo.clearWatch).toHaveBeenCalledWith(99);
  });

  it('does not watch when disabled', () => {
    const geo = stubGeolocation();
    renderHook(() => useGeolocation({ enabled: false }));
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });
});
