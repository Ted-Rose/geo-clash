import { CircleMarker } from 'react-leaflet';

// Renders food items as small circular markers on the Leaflet map.
export default function FoodLayer({ foods = [] }) {
  return (
    <>
      {foods.map((f) => (
        <CircleMarker
          key={f.id}
          center={[f.lat, f.lng]}
          radius={6}
          pathOptions={{
            color: '#fef08a',
            fillColor: '#fef08a',
            fillOpacity: 0.9,
            weight: 2,
          }}
        />
      ))}
    </>
  );
}
