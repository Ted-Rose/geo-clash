import { Fragment } from 'react';
import { CircleMarker, Polyline } from 'react-leaflet';

// Renders each player as a head marker + a tail polyline.
// `players` is the array from the server snapshot/update.
// `myId` is highlighted with a larger head radius.
export default function SnakeLayer({ players = [], myId }) {
  return (
    <>
      {players.map((p) => {
        if (!p.alive) return null;
        const isMe = p.id === myId;

        const tailPositions = (p.tailPoints || []).map((pt) => [pt.lat, pt.lng]);
        const headPos = [p.lat, p.lng];

        return (
          <Fragment key={p.id}>
            {tailPositions.length > 1 && (
              <Polyline
                positions={tailPositions}
                pathOptions={{
                  color: p.color,
                  weight: isMe ? 5 : 4,
                  opacity: 0.75,
                }}
              />
            )}
            <CircleMarker
              center={headPos}
              radius={isMe ? 9 : 7}
              pathOptions={{
                color: '#fff',
                fillColor: p.color,
                fillOpacity: 1,
                weight: 2,
              }}
            />
          </Fragment>
        );
      })}
    </>
  );
}
