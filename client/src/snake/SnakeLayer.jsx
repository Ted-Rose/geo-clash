import { Fragment } from 'react';
import { Marker, Polyline } from 'react-leaflet';
import L from 'leaflet';

function lightenHex(hex, amount = 0.45) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (
    `rgb(${Math.round(r + (255 - r) * amount)},` +
    `${Math.round(g + (255 - g) * amount)},` +
    `${Math.round(b + (255 - b) * amount)})`
  );
}

function makeSnakeHeadIcon(color, heading, isMe) {
  const scale = isMe ? 1.3 : 1;
  const w = Math.round(28 * scale);
  const h = Math.round(40 * scale);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 44" ` +
    `width="${w}" height="${h}">` +
    `<line x1="16" y1="10" x2="16" y2="5" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>` +
    `<line x1="16" y1="5" x2="12" y2="1" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>` +
    `<line x1="16" y1="5" x2="20" y2="1" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M16,6 C9,6 4,12 4,22 C4,33 8,42 16,42 C24,42 28,33 28,22 C28,12 23,6 16,6 Z" ` +
    `fill="${color}" stroke="white" stroke-width="2"/>` +
    `<circle cx="9" cy="20" r="4" fill="white"/>` +
    `<circle cx="9.5" cy="20.5" r="2" fill="#111"/>` +
    `<circle cx="23" cy="20" r="4" fill="white"/>` +
    `<circle cx="23.5" cy="20.5" r="2" fill="#111"/>` +
    `<circle cx="13" cy="11" r="1.5" fill="rgba(0,0,0,0.3)"/>` +
    `<circle cx="19" cy="11" r="1.5" fill="rgba(0,0,0,0.3)"/>` +
    `</svg>`;
  return L.divIcon({
    html:
      `<div style="transform:rotate(${heading}deg);transform-origin:50% 50%;` +
      `width:${w}px;height:${h}px;line-height:0;">${svg}</div>`,
    className: '',
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
  });
}

// Renders each player as a snake-head DivIcon + a two-layer body polyline.
// `players` is the array from the server snapshot/update.
// `myId` is highlighted with a larger head and thicker body.
export default function SnakeLayer({ players = [], myId }) {
  return (
    <>
      {players.map((p) => {
        if (!p.alive) return null;
        const isMe = p.id === myId;
        const headPos = [p.lat, p.lng];
        const tailPositions = (p.tailPoints || []).map(
          (pt) => [pt.lat, pt.lng]
        );
        const bodyPositions =
          tailPositions.length > 0 ? [...tailPositions, headPos] : null;
        const heading = p.heading ?? 0;
        const icon = makeSnakeHeadIcon(p.color, heading, isMe);
        const bellyColor = lightenHex(p.color);

        return (
          <Fragment key={p.id}>
            {bodyPositions && bodyPositions.length > 1 && (
              <>
                <Polyline
                  positions={bodyPositions}
                  pathOptions={{
                    color: p.color,
                    weight: isMe ? 8 : 6,
                    opacity: 0.9,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
                <Polyline
                  positions={bodyPositions}
                  pathOptions={{
                    color: bellyColor,
                    weight: isMe ? 3 : 2,
                    opacity: 0.7,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </>
            )}
            <Marker position={headPos} icon={icon} />
          </Fragment>
        );
      })}
    </>
  );
}
