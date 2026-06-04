import { useEffect, useRef, useState } from 'react';
import { useSound } from '../hooks/useSound.js';
import { MapContainer, TileLayer } from 'react-leaflet';
import { socket, API_BASE } from '../socket.js';
import SnakeHUD from './HUD.jsx';
import FoodLayer from './FoodLayer.jsx';
import SnakeLayer from './SnakeLayer.jsx';
import 'leaflet/dist/leaflet.css';

// --- Geo math (equirectangular, accurate at <1 km) -----------------------
const EARTH_R = 6378137;
const DEG = Math.PI / 180;
function distanceMeters(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) *
    Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

// --- Snake gameplay constants (mirror server/src/snake/constants.js) ------
const MIN_MOVE_M = 1.5;
const TAIL_METERS_PER_SCORE = 5;
const MAX_TAIL_SEGMENTS = 200;
const EAT_RADIUS_M = 4.0;
const COLLISION_RADIUS_M = 2.5;
const NECK_GAP_M = 2.0;
const SPAWN_GRACE_MS = 3000;

const DEFAULT_ZOOM = 19;

// Build a new tail array given the previous tail, where the player was, and
// the current score. Mirrors the server-side logic removed from updateLocation.
function buildTail(prevTail, prevPos, score) {
  let tail = [...prevTail, prevPos];
  const maxLenM = score * TAIL_METERS_PER_SCORE;
  if (maxLenM <= 0) return [];
  let totalLen = 0;
  for (let i = 1; i < tail.length; i++) {
    totalLen += distanceMeters(tail[i - 1], tail[i]);
  }
  while (tail.length > 1 && totalLen > maxLenM) {
    totalLen -= distanceMeters(tail[0], tail[1]);
    tail.shift();
  }
  if (tail.length > MAX_TAIL_SEGMENTS) {
    tail = tail.slice(tail.length - MAX_TAIL_SEGMENTS);
  }
  return tail;
}

// Returns true if head collides with any tail segment (skips inner NECK_GAP).
function collidesWithTail(head, tailPoints) {
  if (!tailPoints || tailPoints.length === 0) return false;
  for (let i = tailPoints.length - 1; i >= 0; i--) {
    const d = distanceMeters(head, tailPoints[i]);
    if (d < NECK_GAP_M) continue;
    if (d <= COLLISION_RADIUS_M) return true;
  }
  return false;
}

export default function SnakeGameScreen({
  roomId,
  myId: myIdProp,
  position,
  simulate,
  simPos,
  setSimPos,
  maxImageryAge,
  initialSnapshot,
  onLeave,
}) {
  const [myId, setMyId] = useState(myIdProp || socket.id);
  const { playEat, playDie } = useSound();
  const myIdRef = useRef(myId);
  useEffect(() => { myIdRef.current = myId; }, [myId]);

  // Enemy players — relayed from server. My own snake is kept locally.
  const [enemyPlayers, setEnemyPlayers] = useState([]);
  const enemyPlayersRef = useRef([]);

  // Server-authoritative food list
  const [foods, setFoods] = useState([]);
  const foodsRef = useRef([]);
  // Locally claimed food IDs (optimistic), cleared when server sends food-update
  const eatenIdsRef = useRef(new Set());

  const [scores, setScores] = useState({});
  const [matchActive, setMatchActive] = useState(false);
  const [matchOver, setMatchOver] = useState(false);
  const [finalLeaderboard, setFinalLeaderboard] = useState(null);
  const [bbox, setBbox] = useState(null);
  const mapRef = useRef(null);
  const simStepRef = useRef(0.00005);

  // --- Local (client-authoritative) snake state ---------------------------
  const myTailRef = useRef([]);
  const myScoreRef = useRef(0);
  const [myScore, setMyScore] = useState(0);
  const mySpawnedAtRef = useRef(Date.now());
  const lastPosRef = useRef(null);
  // Color/name populated from first snapshot so we can render our own snake
  const myInfoRef = useRef(null);

  // Apply initial snapshot
  useEffect(() => {
    if (!initialSnapshot) return;
    const allPlayers = initialSnapshot.players || [];
    const enemies = allPlayers.filter((p) => p.id !== myIdRef.current);
    setEnemyPlayers(enemies);
    enemyPlayersRef.current = enemies;
    setFoods(initialSnapshot.foods || []);
    foodsRef.current = initialSnapshot.foods || [];
    setScores(initialSnapshot.scores || {});
    setMatchActive(initialSnapshot.matchActive ?? false);
    if (initialSnapshot.bbox) setBbox(initialSnapshot.bbox);
    const me = allPlayers.find((p) => p.id === myIdRef.current);
    if (me) myInfoRef.current = { color: me.color, name: me.name };
  }, [initialSnapshot]);

  // --- Socket wiring -------------------------------------------------------
  useEffect(() => {
    function onJoined({ id }) {
      if (id) { setMyId(id); myIdRef.current = id; }
    }
    function onSnapshot(snap) {
      const allPlayers = snap.players || [];
      const enemies = allPlayers.filter((p) => p.id !== myIdRef.current);
      setEnemyPlayers(enemies);
      enemyPlayersRef.current = enemies;
      setFoods(snap.foods || []);
      foodsRef.current = snap.foods || [];
      eatenIdsRef.current.clear();
      setScores(snap.scores || {});
      setMatchActive(snap.matchActive ?? false);
      if (snap.bbox) setBbox(snap.bbox);
      const me = allPlayers.find((p) => p.id === myIdRef.current);
      if (me && !myInfoRef.current) myInfoRef.current = { color: me.color, name: me.name };
    }
    function onSnakeUpdate({ players: ps, scores: sc }) {
      if (ps) {
        const enemies = ps.filter((p) => p.id !== myIdRef.current);
        setEnemyPlayers(enemies);
        enemyPlayersRef.current = enemies;
      }
      if (sc) setScores(sc);
    }
    function onFoodUpdate({ foods: fs }) {
      if (!fs) return;
      setFoods(fs);
      foodsRef.current = fs;
      eatenIdsRef.current.clear();
    }
    function onSnakeAte({ playerId }) {
      if (playerId === myIdRef.current) playEat();
    }
    function onSnakeHit({ victimId }) {
      if (victimId === myIdRef.current) playDie();
    }
    // Server-confirmed reset after a clash kill — wipe local snake state
    function onSnakeReset({ spawnedAt }) {
      myTailRef.current = [];
      myScoreRef.current = 0;
      setMyScore(0);
      mySpawnedAtRef.current = spawnedAt || Date.now();
      lastPosRef.current = null;
    }
    function onMatchStart({ bbox: b, foods: fs }) {
      setMatchActive(true);
      if (b) setBbox(b);
      if (fs) { setFoods(fs); foodsRef.current = fs; eatenIdsRef.current.clear(); }
    }
    function onMatchEnd({ leaderboard }) {
      setMatchOver(true);
      setMatchActive(false);
      setFinalLeaderboard(leaderboard || []);
    }
    // Server asks me to verify a clash: did the reported victim hit my snake?
    function onClashVerify({ victimId }) {
      const victim = enemyPlayersRef.current.find((p) => p.id === victimId);
      if (!victim) return;
      const victimHead = { lat: victim.lat, lng: victim.lng };
      const hitMyTail = collidesWithTail(victimHead, myTailRef.current);
      const myHead = lastPosRef.current;
      const headCollide = myHead
        ? distanceMeters(victimHead, myHead) <= COLLISION_RADIUS_M
        : false;
      if (hitMyTail || headCollide) {
        socket.emit('clash_confirmed', { victimId, confirmed: true });
      }
    }

    socket.on('joined', onJoined);
    socket.on('snapshot', onSnapshot);
    socket.on('snake-update', onSnakeUpdate);
    socket.on('food-update', onFoodUpdate);
    socket.on('match-start', onMatchStart);
    socket.on('match-end', onMatchEnd);
    socket.on('snake-ate', onSnakeAte);
    socket.on('snake-hit', onSnakeHit);
    socket.on('snake-reset', onSnakeReset);
    socket.on('clash_verify', onClashVerify);
    return () => {
      socket.off('joined', onJoined);
      socket.off('snapshot', onSnapshot);
      socket.off('snake-update', onSnakeUpdate);
      socket.off('food-update', onFoodUpdate);
      socket.off('match-start', onMatchStart);
      socket.off('match-end', onMatchEnd);
      socket.off('snake-ate', onSnakeAte);
      socket.off('snake-hit', onSnakeHit);
      socket.off('snake-reset', onSnakeReset);
      socket.off('clash_verify', onClashVerify);
    };
  }, []);

  // --- Position update: tail building, food detection, clash, emit ---------
  useEffect(() => {
    if (!position || !roomId) return;
    const head = { lat: position.lat, lng: position.lng };

    // 1. Build tail locally from movement
    if (lastPosRef.current) {
      const moved = distanceMeters(lastPosRef.current, head);
      if (moved >= MIN_MOVE_M) {
        myTailRef.current = buildTail(
          myTailRef.current,
          lastPosRef.current,
          myScoreRef.current,
        );
      }
    }
    lastPosRef.current = head;

    const graceExpired = Date.now() - mySpawnedAtRef.current >= SPAWN_GRACE_MS;
    if (graceExpired) {
      // 2. Local food collision — optimistic score update, notify server
      for (const food of foodsRef.current) {
        if (eatenIdsRef.current.has(food.id)) continue;
        if (distanceMeters(head, food) <= EAT_RADIUS_M) {
          eatenIdsRef.current.add(food.id);
          myScoreRef.current += 1;
          setMyScore(myScoreRef.current);
          playEat();
          socket.emit('eat_food', { foodId: food.id });
        }
      }

      // 3. Local player-vs-player collision — trigger server handshake
      for (const enemy of enemyPlayersRef.current) {
        if (!enemy.alive) continue;
        if (
          collidesWithTail(head, enemy.tailPoints) ||
          distanceMeters(head, { lat: enemy.lat, lng: enemy.lng }) <= COLLISION_RADIUS_M
        ) {
          socket.emit('clash_detected', { targetId: enemy.id });
          break;
        }
      }
    }

    // 4. Emit full authoritative state to server for relay to peers
    socket.emit('location-update', {
      lat: position.lat,
      lng: position.lng,
      heading: position.heading ?? 0,
      tailPoints: myTailRef.current,
      score: myScoreRef.current,
    });

    // 5. Keep map centred
    if (mapRef.current) mapRef.current.panTo([position.lat, position.lng]);
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

  // Merge enemy players (from server) with our local player state for rendering
  const myInfo = myInfoRef.current;
  const myLocalPlayer = myInfo && position
    ? {
        id: myIdRef.current,
        name: myInfo.name,
        color: myInfo.color,
        lat: position.lat,
        lng: position.lng,
        heading: position.heading ?? 0,
        alive: true,
        score: myScore,
        kills: scores[myIdRef.current]?.kills ?? 0,
        tailPoints: myTailRef.current,
        spawnedAt: mySpawnedAtRef.current,
      }
    : null;

  const allPlayers = myLocalPlayer
    ? [...enemyPlayers, myLocalPlayer]
    : enemyPlayers;

  // For the HUD leaderboard: use local score for myself, server score for others
  const mergedScores = {
    ...scores,
    ...(myInfo && myLocalPlayer
      ? {
          [myIdRef.current]: {
            name: myInfo.name,
            color: myInfo.color,
            score: myScore,
            kills: scores[myIdRef.current]?.kills ?? 0,
          },
        }
      : {}),
  };

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
          url={`${API_BASE}/api/map/tiles/{z}/{y}/{x}?maxAge=${maxImageryAge}`}
          attribution='Tiles &copy; Esri &mdash; Source: Esri, Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community'
          maxZoom={22}
          maxNativeZoom={19}
          key={maxImageryAge}
        />
        <FoodLayer foods={foods} />
        <SnakeLayer players={allPlayers} myId={myId} />
      </MapContainer>

      <SnakeHUD
        players={allPlayers}
        scores={mergedScores}
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
