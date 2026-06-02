import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import { socket } from '../socket.js';
import SnakeHUD from './HUD.jsx';
import FoodLayer from './FoodLayer.jsx';
import SnakeLayer from './SnakeLayer.jsx';
import 'leaflet/dist/leaflet.css';

const DEFAULT_ZOOM = 19;

export default function SnakeGameScreen({
  roomId,
  myId: myIdProp,
  position,
  simulate,
  simPos,
  setSimPos,
  initialSnapshot,
  onLeave,
}) {
  const [myId, setMyId] = useState(myIdProp || socket.id);
  const [players, setPlayers] = useState([]);
  const [foods, setFoods] = useState([]);
  const [scores, setScores] = useState({});
  const [matchActive, setMatchActive] = useState(false);
  const [matchOver, setMatchOver] = useState(false);
  const [finalLeaderboard, setFinalLeaderboard] = useState(null);
  const [bbox, setBbox] = useState(null);
  const mapRef = useRef(null);
  const simStepRef = useRef(0.00005);

  // Apply initial snapshot
  useEffect(() => {
    if (initialSnapshot) {
      setPlayers(initialSnapshot.players || []);
      setFoods(initialSnapshot.foods || []);
      setScores(initialSnapshot.scores || {});
      setMatchActive(initialSnapshot.matchActive ?? false);
      if (initialSnapshot.bbox) setBbox(initialSnapshot.bbox);
    }
  }, [initialSnapshot]);

  // Socket wiring
  useEffect(() => {
    function onJoined({ id }) { if (id) setMyId(id); }
    function onSnapshot(snap) {
      setPlayers(snap.players || []);
      setFoods(snap.foods || []);
      setScores(snap.scores || {});
      setMatchActive(snap.matchActive ?? false);
      if (snap.bbox) setBbox(snap.bbox);
    }
    function onSnakeUpdate({ players: ps, scores: sc }) {
      if (ps) setPlayers(ps);
      if (sc) setScores(sc);
    }
    function onFoodUpdate({ foods: fs }) { if (fs) setFoods(fs); }
    function onMatchStart({ bbox: b, foods: fs }) {
      setMatchActive(true);
      if (b) setBbox(b);
      if (fs) setFoods(fs);
    }
    function onMatchEnd({ leaderboard }) {
      setMatchOver(true);
      setMatchActive(false);
      setFinalLeaderboard(leaderboard || []);
    }

    socket.on('joined', onJoined);
    socket.on('snapshot', onSnapshot);
    socket.on('snake-update', onSnakeUpdate);
    socket.on('food-update', onFoodUpdate);
    socket.on('match-start', onMatchStart);
    socket.on('match-end', onMatchEnd);
    return () => {
      socket.off('joined', onJoined);
      socket.off('snapshot', onSnapshot);
      socket.off('snake-update', onSnakeUpdate);
      socket.off('food-update', onFoodUpdate);
      socket.off('match-start', onMatchStart);
      socket.off('match-end', onMatchEnd);
    };
  }, []);

  // Send location updates
  useEffect(() => {
    if (!position || !roomId) return;
    socket.emit('location-update', {
      lat: position.lat,
      lng: position.lng,
      heading: position.heading ?? 0,
    });
  }, [position, roomId]);

  // Keyboard WASD movement in sim mode
  useEffect(() => {
    if (!simulate || !simPos) return;
    function onKey(e) {
      const step = simStepRef.current;
      let dLat = 0, dLng = 0;
      if (e.key === 'ArrowUp' || e.key === 'w') dLat = step;
      else if (e.key === 'ArrowDown' || e.key === 's') dLat = -step;
      else if (e.key === 'ArrowLeft' || e.key === 'a') dLng = -step;
      else if (e.key === 'ArrowRight' || e.key === 'd') dLng = step;
      else return;
      e.preventDefault();
      setSimPos((p) => ({ ...p, lat: p.lat + dLat, lng: p.lng + dLng }));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [simulate, simPos, setSimPos]);

  function handleLeave() {
    socket.emit('room-leave');
    onLeave();
  }

  const center = position
    ? [position.lat, position.lng]
    : bbox
    ? [(bbox.south + bbox.north) / 2, (bbox.west + bbox.east) / 2]
    : [51.5, -0.12];

  if (matchOver) {
    return (
      <div className="absolute inset-0 z-[1100] flex items-start justify-center bg-slate-900/95 backdrop-blur p-4 overflow-y-auto">
        <div className="w-full max-w-md space-y-4 py-4">
          <div className="text-center space-y-1">
            <div className="text-xs uppercase tracking-widest text-slate-400">Match over</div>
            {finalLeaderboard?.[0] && (
              <div className="text-2xl font-extrabold">
                🏆{' '}
                <span style={{ color: finalLeaderboard[0].color }}>
                  {finalLeaderboard[0].name}
                </span>{' '}
                wins
              </div>
            )}
          </div>
          <section className="bg-slate-800 rounded-2xl p-4 shadow-lg">
            <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-2">Final scores</h3>
            <ul className="space-y-1">
              {(finalLeaderboard || []).map((row, i) => (
                <li
                  key={row.id}
                  className="flex justify-between items-center px-2 py-1 rounded-md odd:bg-slate-900/50"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-slate-500 tabular-nums w-5 text-right">{i + 1}</span>
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ background: row.color }}
                    />
                    <span className="font-semibold">{row.name}</span>
                  </span>
                  <span className="tabular-nums font-bold">{row.score}</span>
                </li>
              ))}
            </ul>
          </section>
          <button
            onClick={handleLeave}
            className="w-full py-3 rounded-xl bg-cyan-500 text-slate-900 font-bold shadow active:scale-95 transition"
          >
            Back to lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <MapContainer
        center={center}
        zoom={DEFAULT_ZOOM}
        className="w-full h-full"
        zoomControl={false}
        ref={mapRef}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={22}
          maxNativeZoom={19}
        />
        <FoodLayer foods={foods} />
        <SnakeLayer players={players} myId={myId} />
      </MapContainer>

      <SnakeHUD
        players={players}
        scores={scores}
        myId={myId}
      />

      {simulate && simPos && (
        <div className="pointer-events-auto absolute left-3 bottom-6 z-[600] bg-slate-900/90 border border-slate-700 rounded-xl p-3 text-xs space-y-1 max-w-[180px]">
          <div className="font-bold text-slate-200">Simulate</div>
          <div className="text-slate-400">WASD / arrows to move</div>
          <div className="text-slate-500 tabular-nums">
            {simPos.lat.toFixed(6)}, {simPos.lng.toFixed(6)}
          </div>
        </div>
      )}

      <button
        onClick={handleLeave}
        className="pointer-events-auto absolute top-3 left-1/2 -translate-x-1/2 z-[600] bg-slate-800/90 text-slate-300 text-xs px-3 py-1 rounded-full border border-slate-700 active:scale-95"
      >
        Leave
      </button>
    </div>
  );
}
