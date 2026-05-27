import { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Polygon,
  CircleMarker,
  Tooltip,
  useMap,
  Marker,
  Popup,
} from 'react-leaflet';
import L from 'leaflet';

// Auto-recenters the map when the local player's position changes meaningfully.
function Recenter({ center }) {
  const map = useMap();
  const last = useRef(null);
  useEffect(() => {
    if (!center) return;
    const [lat, lng] = center;
    if (!last.current) {
      map.setView([lat, lng], 19);
    } else {
      const [plat, plng] = last.current;
      const d = Math.hypot(lat - plat, lng - plng);
      if (d > 0.00005) map.panTo([lat, lng], { animate: true });
    }
    last.current = [lat, lng];
  }, [center, map]);
  return null;
}

// Heading arrow icon for the local player (rotates to face heading).
function headingIcon(color, heading) {
  return L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `
      <div style="transform: rotate(${heading || 0}deg); width:28px; height:28px;">
        <div style="
          width:0; height:0;
          margin:0 auto;
          border-left:9px solid transparent;
          border-right:9px solid transparent;
          border-bottom:18px solid ${color};
          filter: drop-shadow(0 0 2px rgba(0,0,0,0.6));
        "></div>
      </div>
    `,
  });
}

export default function MapView({
  grid,
  ownership,
  players,
  me,
  myHeading,
  baseCellId,
  arrows,
}) {
  const center = useMemo(() => {
    if (me) return [me.lat, me.lng];
    if (grid) {
      const { south, north, west, east } = grid.bbox;
      return [(south + north) / 2, (west + east) / 2];
    }
    return [52.52, 13.405]; // fallback: Berlin
  }, [me, grid]);

  const ownershipMap = useMemo(() => {
    const m = new Map();
    for (const o of ownership || []) m.set(o.id, o);
    return m;
  }, [ownership]);

  return (
    <MapContainer
      center={center}
      zoom={19}
      maxZoom={22}
      zoomControl={false}
      className="absolute inset-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxNativeZoom={19}
        maxZoom={22}
      />

      {/* Grid cells */}
      {grid?.cells.map((cell) => {
        const own = ownershipMap.get(cell.id);
        const isBase = cell.id === baseCellId;
        const fill = own?.color || (isBase ? '#facc15' : '#94a3b8');
        const opacity = own?.color ? 0.55 : isBase ? 0.35 : 0.06;
        return (
          <Polygon
            key={cell.id}
            positions={cell.polygon}
            pathOptions={{
              color: own?.color || (isBase ? '#facc15' : '#1e293b'),
              weight: isBase ? 2 : 1,
              fillColor: fill,
              fillOpacity: opacity,
            }}
          />
        );
      })}

      {/* Other players */}
      {players?.filter((p) => !me || p.id !== me.id).map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.lat, p.lng]}
          radius={8}
          pathOptions={{
            color: p.shieldActive ? '#fde047' : '#0f172a',
            weight: p.shieldActive ? 3 : 2,
            fillColor: p.color,
            fillOpacity: p.alive ? 0.95 : 0.3,
          }}
        >
          <Tooltip permanent direction="top" offset={[0, -10]}>
            <span className="text-xs">{p.name} ❤{p.lives}</span>
          </Tooltip>
        </CircleMarker>
      ))}

      {/* Local player as a heading arrow */}
      {me && (
        <Marker
          position={[me.lat, me.lng]}
          icon={headingIcon(me.color || '#22d3ee', myHeading)}
        >
          <Popup>You ({me.name})</Popup>
        </Marker>
      )}

      {/* Arrow trails (briefly drawn after attacks) */}
      {arrows?.map((a) => (
        <Polygon
          key={a.key}
          positions={a.poly}
          pathOptions={{
            color: a.color,
            weight: 2,
            fillColor: a.color,
            fillOpacity: 0.4,
          }}
        />
      ))}

      <Recenter center={center} />
    </MapContainer>
  );
}
