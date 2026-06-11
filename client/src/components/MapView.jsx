import { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Polygon,
  useMap,
  Marker,
  Popup,
} from 'react-leaflet';
import L from 'leaflet';
import { API_BASE } from '../socket.js';

// Auto-recenters the map when the local player's position changes meaningfully.
function Recenter({ center, mapLocked }) {
  const map = useMap();
  const last = useRef(null);
  useEffect(() => {
    if (mapLocked || !center) return;
    const [lat, lng] = center;
    if (!last.current) {
      map.setView([lat, lng], 19);
    } else {
      const [plat, plng] = last.current;
      const d = Math.hypot(lat - plat, lng - plng);
      if (d > 0.00005) map.panTo([lat, lng], { animate: true });
    }
    last.current = [lat, lng];
  }, [center, map, mapLocked]);
  return null;
}

// Fits the map to the arena bounding box and locks/unlocks interactions.
function MapController({ grid, mapLocked }) {
  const map = useMap();
  useEffect(() => {
    if (mapLocked && grid) {
      const { south, north, west, east } = grid.bbox;
      map.fitBounds(
        [[south, west], [north, east]],
        { padding: [16, 16], animate: true }
      );
      map.dragging.disable();
      map.scrollWheelZoom.disable();
      map.doubleClickZoom.disable();
      map.touchZoom.disable();
      map.boxZoom.disable();
    } else {
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      map.doubleClickZoom.enable();
      map.touchZoom.enable();
      map.boxZoom.enable();
    }
  }, [mapLocked, grid, map]);
  return null;
}

// Fighter-jet player icon: top-down SVG warplane whose nose points north
// (heading 0). The whole div is rotated by heading so the marker stays on
// the player's exact map position regardless of direction.
function playerIcon(color, heading, isMe, shieldActive, alive, lives) {
  const size    = isMe ? 44 : 36;
  const half    = size / 2;
  const opacity = alive === false ? 0.35 : 1;

  const strokeColor = shieldActive ? '#fde047' : '#ffffff';
  const strokeW     = shieldActive ? 2.5 : 1.8;

  const livesRatio = alive === false
    ? 0
    : Math.max(0, Math.min(3, lives ?? 3)) / 3;
  const engineColor = livesRatio >= 1
    ? '#ff6820'
    : livesRatio >= 0.67
    ? '#facc15'
    : livesRatio > 0
    ? '#ef4444'
    : '#374151';
  const engineOpacity = livesRatio > 0 ? 0.9 : 0.4;

  const ringSize   = size + (isMe ? 14 : 10);
  const ringOffset = half - ringSize / 2;
  const shieldRing = shieldActive
    ? `<div class="shield-pulse" style="position:absolute;top:${ringOffset}px;left:${ringOffset}px;width:${ringSize}px;height:${ringSize}px;border-radius:50%;border:2px solid #fde047;box-shadow:0 0 6px 1px #fde04799;pointer-events:none;"></div>`
    : '';

  const sw2 = (strokeW * 0.67).toFixed(1);
  const sw3 = (strokeW * 0.5).toFixed(1);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" ` +
    `width="${size}" height="${size}" style="display:block;">` +
    // Fuselage
    `<path d="M20,2 L23,12 L24,30 L22,37 L20,39 L18,37 L16,30 L17,12 Z" ` +
    `fill="${color}" stroke="${strokeColor}" stroke-width="${strokeW}" stroke-linejoin="round"/>` +
    // Left swept wing
    `<path d="M17,12 L2,28 L16,22 Z" ` +
    `fill="${color}" stroke="${strokeColor}" stroke-width="${sw2}" stroke-linejoin="round"/>` +
    // Right swept wing
    `<path d="M23,12 L38,28 L24,22 Z" ` +
    `fill="${color}" stroke="${strokeColor}" stroke-width="${sw2}" stroke-linejoin="round"/>` +
    // Left horizontal stabilizer
    `<path d="M16,30 L10,39 L17,34 Z" ` +
    `fill="${color}" stroke="${strokeColor}" stroke-width="${sw3}" stroke-linejoin="round"/>` +
    // Right horizontal stabilizer
    `<path d="M24,30 L30,39 L23,34 Z" ` +
    `fill="${color}" stroke="${strokeColor}" stroke-width="${sw3}" stroke-linejoin="round"/>` +
    // Cockpit canopy
    `<ellipse cx="20" cy="16" rx="2.5" ry="5" ` +
    `fill="rgba(150,220,255,0.75)" stroke="rgba(200,240,255,0.6)" stroke-width="0.5"/>` +
    // Engine exhaust glow – colour reflects remaining lives
    `<ellipse cx="20" cy="37" rx="2.2" ry="1.5" fill="${engineColor}" opacity="${engineOpacity}"/>` +
    `</svg>`;

  return L.divIcon({
    className: '',
    iconSize:   [size, size],
    iconAnchor: [half, half],
    html:
      `<div style="width:${size}px;height:${size}px;position:relative;` +
      `transform:rotate(${heading || 0}deg);opacity:${opacity};">` +
      `${shieldRing}${svg}</div>`,
  });
}

export default function MapView({
  grid,
  ownership,
  players,
  me,
  myHeading,
  baseCellId,
  children,
  onMapLongPress,
  mapLocked,
  maxImageryAge = 3,
  maxNativeZoom = 19,
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
        attribution='Tiles &copy; Esri &mdash; Source: Esri, Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community'
        url={`${API_BASE}/api/map/tiles/{z}/{y}/{x}?maxAge=${maxImageryAge}`}
        maxNativeZoom={maxNativeZoom}
        maxZoom={22}
        key={`${maxImageryAge}-${maxNativeZoom}`}
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
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={playerIcon(p.color, p.heading, false, p.shieldActive, p.alive, p.lives)}
        />
      ))}

      {/* Local player – larger icon, direction always current */}
      {me && (
        <Marker
          position={[me.lat, me.lng]}
          icon={playerIcon(me.color || '#22d3ee', myHeading, true, me.shieldActive, me.alive, me.lives)}
        >
          <Popup>You ({me.name})</Popup>
        </Marker>
      )}

      {/* Slot for transient overlays (projectile layer, target marker, …) */}
      {children}

      {onMapLongPress && <LongPressBinder onLongPress={onMapLongPress} />}

      <MapController grid={grid} mapLocked={mapLocked} />
      <Recenter center={center} mapLocked={mapLocked} />
    </MapContainer>
  );
}

// Bind a long-press / right-click on the map to onLongPress({lat,lng}).
// Plain Leaflet 'contextmenu' covers desktop right-click and mobile
// long-press on most browsers via Leaflet's native handling.
function LongPressBinder({ onLongPress }) {
  const map = useMap();
  useEffect(() => {
    function handler(e) {
      onLongPress({ lat: e.latlng.lat, lng: e.latlng.lng });
    }
    map.on('contextmenu', handler);
    return () => { map.off('contextmenu', handler); };
  }, [map, onLongPress]);
  return null;
}
