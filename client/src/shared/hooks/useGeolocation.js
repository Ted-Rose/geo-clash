import { useEffect, useRef, useState } from 'react';

// Watches device GPS. When `simulated` is provided, returns that instead so we
// can play on desktop without GPS. Also surfaces heading where available
// (mobile compass), falling back to bearing computed from movement deltas.
export function useGeolocation({ enabled = true, simulated = null } = {}) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const lastPosRef = useRef(null);

  useEffect(() => {
    if (simulated) {
      setPosition(simulated);
      return;
    }
    if (!enabled) return;
    if (!('geolocation' in navigator)) {
      setError('Geolocation not supported');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
        };
        if (next.heading == null && lastPosRef.current) {
          next.heading = bearing(lastPosRef.current, next);
        }
        lastPosRef.current = next;
        setPosition(next);
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, simulated]);

  return { position, error };
}

function bearing(a, b) {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}
