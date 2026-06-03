import { Marker } from 'react-leaflet';
import L from 'leaflet';

const DEFAULT_EMOJI = '🍎';

function makeFoodIcon(emoji) {
  return L.divIcon({
    html: `<span style="font-size:22px;line-height:1;display:block;text-align:center;">${emoji || DEFAULT_EMOJI}</span>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Renders food items as emoji markers on the Leaflet map.
export default function FoodLayer({ foods = [] }) {
  return (
    <>
      {foods.map((f) => (
        <Marker
          key={f.id}
          position={[f.lat, f.lng]}
          icon={makeFoodIcon(f.emoji)}
          interactive={false}
        />
      ))}
    </>
  );
}
