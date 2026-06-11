import { Fragment, useEffect, useRef, useState } from 'react';
import { Marker, Polyline } from 'react-leaflet';
import L from 'leaflet';

// Top-down rocket SVG pointing north (heading 0). The div is rotated by the
// computed heading so the nose always faces the direction of travel.
function rocketIcon(heading) {
  const w = 14;
  const h = 26;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 26" ` +
    `width="${w}" height="${h}" style="display:block;">` +
    // Nose cone
    `<path d="M7,1 L11,9 L3,9 Z" fill="#ef4444" stroke="#fca5a5" stroke-width="0.5"/>` +
    // Body
    `<rect x="3" y="9" width="8" height="11" rx="1" ` +
    `fill="#f97316" stroke="#fed7aa" stroke-width="0.5"/>` +
    // Cockpit window
    `<ellipse cx="7" cy="13" rx="2" ry="2.5" ` +
    `fill="rgba(147,210,255,0.65)" stroke="rgba(255,255,255,0.5)" stroke-width="0.5"/>` +
    // Left fin
    `<path d="M3,17 L0,24 L3,21 Z" fill="#dc2626"/>` +
    // Right fin
    `<path d="M11,17 L14,24 L11,21 Z" fill="#dc2626"/>` +
    // Engine nozzle
    `<rect x="4.5" y="20" width="5" height="2" rx="0.5" fill="#1e293b"/>` +
    // Outer exhaust flame
    `<path d="M5,22 L7,27 L9,22 Z" fill="#f97316" opacity="0.95"/>` +
    // Inner exhaust flame (yellow core)
    `<path d="M5.5,22 L7,26 L8.5,22 Z" fill="#fde047" opacity="0.9"/>` +
    `</svg>`;

  return L.divIcon({
    className: '',
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
    html:
      `<div style="transform:rotate(${heading}deg);` +
      `width:${w}px;height:${h}px;">${svg}</div>`,
  });
}

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

          // Heading: degrees clockwise from north, for CSS rotate()
          const dLat = p.target.lat - p.origin.lat;
          const dLng = p.target.lng - p.origin.lng;
          const heading = Math.atan2(dLng, dLat) * (180 / Math.PI);

          // Short orange exhaust trail behind the rocket
          const trailU = Math.max(0, u - 0.1);
          const trailLat =
            p.origin.lat + (p.target.lat - p.origin.lat) * trailU;
          const trailLng =
            p.origin.lng + (p.target.lng - p.origin.lng) * trailU;

          return (
            <Fragment key={p.id}>
              <Polyline
                positions={[[trailLat, trailLng], [lat, lng]]}
                pathOptions={{ color: '#fb923c', weight: 3, opacity: 0.5 }}
              />
              <Marker position={[lat, lng]} icon={rocketIcon(heading)} />
            </Fragment>
          );
        })}
    </>
  );
}
