import { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Polygon,
  Tooltip,
  useMap,
  Marker,
  Popup,
} from 'react-leaflet';
import L from 'leaflet';

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

// Directional player icon: circle body (at icon centre) with an arrow tip
// pointing in the heading direction. Rotation is around the circle centre so
// the marker stays on the player's exact map position regardless of heading.
function playerIcon(color, heading, isMe, shieldActive, alive) {
  const size    = isMe ? 38 : 30;
  const half    = size / 2;
  const circleD = isMe ? 20 : 14;
  const circleR = circleD / 2;
  const arrowH  = half - circleR;        // space above the circle
  const arrowW  = isMe ? 7 : 5;          // half-width of the arrow base
  const borderColor = shieldActive ? '#fde047' : '#ffffff';
  const borderW     = shieldActive ? 3 : isMe ? 2.5 : 1.5;
  const shadow      = shieldActive
    ? '0 0 7px 2px #fde04799'
    : isMe
    ? '0 0 5px rgba(0,0,0,0.6)'
    : '0 0 3px rgba(0,0,0,0.45)';
  const opacity = alive === false ? 0.35 : 1;
  const ringSize = circleD + (isMe ? 14 : 10);
  const ringOffset = half - ringSize / 2;
  const shieldRing = shieldActive
    ? `<div class="shield-pulse" style="position:absolute;top:${ringOffset}px;left:${ringOffset}px;width:${ringSize}px;height:${ringSize}px;border-radius:50%;border:2px solid #fde047;box-shadow:0 0 6px 1px #fde04799;pointer-events:none;"></div>`
    : '';
  return L.divIcon({
    className: '',
    iconSize:   [size, size],
    iconAnchor: [half, half],
    html: `<div style="width:${size}px;height:${size}px;position:relative;transform:rotate(${heading || 0}deg);opacity:${opacity};">
      ${shieldRing}
      <div style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:0;height:0;border-left:${arrowW}px solid transparent;border-right:${arrowW}px solid transparent;border-bottom:${arrowH + 1}px solid ${color};"></div>
      <div style="position:absolute;top:${half - circleR}px;left:${half - circleR}px;width:${circleD}px;height:${circleD}px;border-radius:50%;background:${color};border:${borderW}px solid ${borderColor};box-shadow:${shadow};"></div>
    </div>`,
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
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={playerIcon(p.color, p.heading, false, p.shieldActive, p.alive)}
        >
          <Tooltip permanent direction="top" offset={[0, -10]}>
            <span className="text-xs">{p.name} ❤{p.lives}</span>
          </Tooltip>
        </Marker>
      ))}

      {/* Local player – larger icon, direction always current */}
      {me && (
        <Marker
          position={[me.lat, me.lng]}
          icon={playerIcon(me.color || '#22d3ee', myHeading, true, me.shieldActive, me.alive)}
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
