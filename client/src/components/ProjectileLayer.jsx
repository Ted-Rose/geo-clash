import { useEffect, useRef, useState } from 'react';
import { Polygon } from 'react-leaflet';

// Renders in-flight projectiles by interpolating their position from the
// server-committed (origin, target, tSpawn, tArrival) packet. Re-render
// loop is driven by requestAnimationFrame; expired projectiles are pruned
// locally as a render-side fallback (server emits projectile-resolved at
// the same instant, but the layer should not depend on that arrival).
export default function ProjectileLayer({ projectiles, skewMs = 0 }) {
  const [, setTick] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    function loop() {
      setTick((n) => (n + 1) & 0xffff);
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const tServer = Date.now() + skewMs;

  return (
    <>
      {projectiles
        .filter((p) => p.tArrival > tServer && p.tSpawn <= tServer + 500)
        .map((p) => {
          const u = Math.min(
            1,
            Math.max(0, (tServer - p.tSpawn) / (p.tArrival - p.tSpawn))
          );
          const lat = p.origin.lat + (p.target.lat - p.origin.lat) * u;
          const lng = p.origin.lng + (p.target.lng - p.origin.lng) * u;
          // tiny diamond around the head + a thin tail to the origin
          const tailLat = p.origin.lat + (lat - p.origin.lat) * Math.max(0, u - 0.15);
          const tailLng = p.origin.lng + (lng - p.origin.lng) * Math.max(0, u - 0.15);
          // perpendicular offset for visual width
          const dLat = (lat - p.origin.lat);
          const dLng = (lng - p.origin.lng);
          const perpLat = -dLng * 0.04;
          const perpLng = dLat * 0.04;
          const poly = [
            [tailLat + perpLat, tailLng + perpLng],
            [tailLat - perpLat, tailLng - perpLng],
            [lat - perpLat, lng - perpLng],
            [lat + perpLat, lng + perpLng],
          ];
          return (
            <Polygon
              key={p.id}
              positions={poly}
              pathOptions={{
                color: '#fef08a',
                weight: 2,
                fillColor: '#fef08a',
                fillOpacity: 0.7,
              }}
            />
          );
        })}
    </>
  );
}
