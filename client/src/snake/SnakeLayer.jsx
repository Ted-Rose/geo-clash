import { Fragment } from 'react';
import { Marker, CircleMarker } from 'react-leaflet';
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

// Equirectangular distance between two [lat, lng] pairs (metres).
const EARTH_R = 6378137;
const DEG = Math.PI / 180;
function distM(a, b) {
  const dLat = (b[0] - a[0]) * DEG;
  const dLng = (b[1] - a[1]) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * DEG) * Math.cos(b[0] * DEG) *
    Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

// Sample `count` evenly-spaced positions along a geo path ([lat,lng][]).
function sampleEvenPoints(path, count) {
  if (!path || path.length === 0 || count <= 0) return [];
  if (path.length === 1) return [path[0]];
  const cumDist = [0];
  for (let i = 1; i < path.length; i++) {
    cumDist.push(cumDist[i - 1] + distM(path[i - 1], path[i]));
  }
  const totalLen = cumDist[cumDist.length - 1];
  if (totalLen <= 0) return [path[0]];
  const result = [];
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const target = count > 1 ? (i / (count - 1)) * totalLen : 0;
    while (seg < cumDist.length - 2 && cumDist[seg + 1] < target) seg++;
    const segLen = (cumDist[seg + 1] ?? cumDist[seg]) - cumDist[seg];
    const t = segLen > 0 ? (target - cumDist[seg]) / segLen : 0;
    const a = path[seg];
    const b = path[seg + 1] ?? a;
    result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return result;
}

const BALLS_PER_SCORE = 5;

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

// Renders each player as a snake-head DivIcon + tail balls (CircleMarkers).
// `players` is the array from the server snapshot/update.
// `myId` is highlighted with a larger head and bigger balls.
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
        const score = p.score || 0;
        const ballCount = score * BALLS_PER_SCORE;
        const heading = p.heading ?? 0;
        const icon = makeSnakeHeadIcon(p.color, heading, isMe);
        const bellyColor = lightenHex(p.color);

        // Full path: tail tip → head, sample ballCount+1 points then
        // drop the last (head) so balls stay behind the head marker.
        const fullPath =
          tailPositions.length > 0
            ? [...tailPositions, headPos]
            : null;
        const ballPositions =
          fullPath && ballCount > 0
            ? sampleEvenPoints(fullPath, ballCount + 1).slice(0, ballCount)
            : [];

        // Ball radius ≈ half the head pixel size (head ~28 px wide).
        const outerR = isMe ? 9 : 7;
        const innerR = isMe ? 4 : 3;

        return (
          <Fragment key={p.id}>
            {ballPositions.map((pos, idx) => (
              <Fragment key={idx}>
                <CircleMarker
                  center={pos}
                  radius={outerR}
                  pathOptions={{
                    color: 'white',
                    weight: 1.5,
                    fillColor: p.color,
                    fillOpacity: 0.92,
                    opacity: 0.85,
                  }}
                />
                <CircleMarker
                  center={pos}
                  radius={innerR}
                  pathOptions={{
                    color: 'transparent',
                    weight: 0,
                    fillColor: bellyColor,
                    fillOpacity: 0.55,
                  }}
                />
              </Fragment>
            ))}
            <Marker position={headPos} icon={icon} />
          </Fragment>
        );
      })}
    </>
  );
}
