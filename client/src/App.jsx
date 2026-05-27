import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { socket } from './socket.js';
import { useGeolocation } from './hooks/useGeolocation.js';
import MapView from './components/MapView.jsx';
import HUD from './components/HUD.jsx';
import ControlPanel from './components/ControlPanel.jsx';
import AreaPicker from './components/AreaPicker.jsx';
import SimPanel from './components/SimPanel.jsx';

// Convert a heading (degrees, 0 = north, cw) + origin into a long thin
// polygon we can draw as a transient arrow trail.
function arrowPoly(origin, heading, lengthM = 30) {
  const φ = origin.lat * Math.PI / 180;
  const dLat = (lengthM / 111320) * Math.cos((heading * Math.PI) / 180);
  const dLng =
    (lengthM / (111320 * Math.cos(φ))) * Math.sin((heading * Math.PI) / 180);
  const tip = [origin.lat + dLat, origin.lng + dLng];
  // half-meter side polygon (thin)
  const perpLat = -dLng * 0.02;
  const perpLng = dLat * 0.02;
  return [
    [origin.lat + perpLat, origin.lng + perpLng],
    [origin.lat - perpLat, origin.lng - perpLng],
    [tip[0] - perpLat, tip[1] - perpLng],
    [tip[0] + perpLat, tip[1] + perpLng],
  ];
}

export default function App() {
  // --- connection / identity ------------------------------------------------
  const [myId, setMyId] = useState(null);
  const [joined, setJoined] = useState(false);

  // --- server-driven state --------------------------------------------------
  const [grid, setGrid] = useState(null);
  const [ownership, setOwnership] = useState([]);
  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState({});
  const [remainingSeconds, setRemainingSeconds] = useState(300);
  const [shieldUntil, setShieldUntil] = useState(0);
  const [arrows, setArrows] = useState([]);

  // --- local input ----------------------------------------------------------
  const [simulate, setSimulate] = useState(false);
  const [simPos, setSimPos] = useState(null);
  const { position: gpsPos } = useGeolocation({
    enabled: !simulate,
    simulated: simulate ? simPos : null,
  });

  // bots are extra socket.io connections from this tab — convenient for testing.
  const [bots, setBots] = useState([]);

  // --- wire socket events ---------------------------------------------------
  useEffect(() => {
    function onSnapshot(s) {
      if (s.grid) setGrid(s.grid);
      if (s.ownership) setOwnership(s.ownership);
      if (s.players) setPlayers(s.players);
      if (s.scores) setScores(s.scores);
      if (typeof s.remainingSeconds === 'number') setRemainingSeconds(s.remainingSeconds);
    }
    function onJoined({ id }) {
      setMyId(id);
      setJoined(true);
    }
    function onPlayers({ players }) {
      setPlayers(players);
    }
    function onGrid({ cells, scores }) {
      setOwnership((prev) => {
        const m = new Map(prev.map((c) => [c.id, c]));
        for (const c of cells) m.set(c.id, c);
        return [...m.values()];
      });
      if (scores) setScores(scores);
    }
    function onTimer({ remainingSeconds }) {
      setRemainingSeconds(remainingSeconds);
    }
    function onShield({ id, until }) {
      if (id === socket.id) setShieldUntil(until);
    }
    function onShieldEnd({ id }) {
      if (id === socket.id) setShieldUntil(0);
    }
    function onAttack({ from, heading, attackerId }) {
      const attacker = players.find((p) => p.id === attackerId);
      const color = attacker?.color || '#fef08a';
      const key = `${attackerId}-${Date.now()}`;
      const poly = arrowPoly(from, heading, 30);
      setArrows((prev) => [...prev, { key, poly, color }]);
      setTimeout(() => {
        setArrows((prev) => prev.filter((a) => a.key !== key));
      }, 400);
    }

    socket.on('snapshot', onSnapshot);
    socket.on('joined', onJoined);
    socket.on('players-update', onPlayers);
    socket.on('grid-update', onGrid);
    socket.on('timer', onTimer);
    socket.on('player-shield', onShield);
    socket.on('player-shield-end', onShieldEnd);
    socket.on('player-attack', onAttack);

    return () => {
      socket.off('snapshot', onSnapshot);
      socket.off('joined', onJoined);
      socket.off('players-update', onPlayers);
      socket.off('grid-update', onGrid);
      socket.off('timer', onTimer);
      socket.off('player-shield', onShield);
      socket.off('player-shield-end', onShieldEnd);
      socket.off('player-attack', onAttack);
    };
  }, [players]);

  // --- when simulate toggles on, seed a position --------------------------
  useEffect(() => {
    if (simulate && !simPos) {
      if (gpsPos) {
        setSimPos({ lat: gpsPos.lat, lng: gpsPos.lng, heading: 0 });
      } else {
        // a city-park-ish default so OSM tiles render something interesting
        setSimPos({ lat: 52.5163, lng: 13.3777, heading: 0 });
      }
    }
  }, [simulate, simPos, gpsPos]);

  // --- stream our position to the server ----------------------------------
  const position = simulate ? simPos : gpsPos;
  const lastSentRef = useRef(0);
  useEffect(() => {
    if (!joined || !position) return;
    const now = Date.now();
    if (now - lastSentRef.current < 250) return;
    lastSentRef.current = now;
    socket.emit('location-update', {
      lat: position.lat,
      lng: position.lng,
      heading: position.heading ?? 0,
    });
  }, [position, joined]);

  // --- derived state -------------------------------------------------------
  const me = useMemo(
    () => players.find((p) => p.id === myId) || null,
    [players, myId]
  );

  const mySquares = useMemo(() => {
    if (!me) return 0;
    return ownership.filter((c) => c.ownerId === me.id).length;
  }, [ownership, me]);

  const leaderboard = useMemo(() => {
    return Object.entries(scores)
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => b.squares - a.squares);
  }, [scores]);

  // is local player standing in base cell?
  const atBase = useMemo(() => {
    if (!grid || !position) return false;
    const cell = grid.cells.find((c) => c.id === grid.baseCellId);
    if (!cell) return false;
    const [a, b, , d] = cell.polygon;
    // polygon = [[south,west],[south,east],[north,east],[north,west]]
    const south = a[0];
    const west = a[1];
    const east = b[1];
    const north = d[0];
    return (
      position.lat >= south &&
      position.lat <= north &&
      position.lng >= west &&
      position.lng <= east
    );
  }, [grid, position]);

  // --- actions ------------------------------------------------------------
  const handleJoin = ({ name }) => {
    if (!position) return;
    socket.emit('player-join', {
      name,
      lat: position.lat,
      lng: position.lng,
    });
  };
  const attack = () =>
    socket.emit('player-attack', { heading: position?.heading ?? 0 });
  const shield = () => socket.emit('player-shield');
  const respawn = () => socket.emit('player-respawn');

  // --- bots ---------------------------------------------------------------
  const spawnBot = () => {
    if (!grid) return;
    const { bbox } = grid;
    const botSocket = io('/', { transports: ['websocket', 'polling'] });
    let lat = bbox.south + Math.random() * (bbox.north - bbox.south);
    let lng = bbox.west + Math.random() * (bbox.east - bbox.west);
    let heading = Math.random() * 360;
    botSocket.on('connect', () => {
      botSocket.emit('player-join', {
        name: `Bot-${bots.length + 1}`,
        lat,
        lng,
      });
    });
    const interval = setInterval(() => {
      // random walk, bounce off bbox edges
      heading += (Math.random() - 0.5) * 30;
      const φ = (lat * Math.PI) / 180;
      const stepM = 2 + Math.random() * 3;
      const dLat = (stepM / 111320) * Math.cos((heading * Math.PI) / 180);
      const dLng =
        (stepM / (111320 * Math.cos(φ))) * Math.sin((heading * Math.PI) / 180);
      lat = Math.min(bbox.north - 1e-6, Math.max(bbox.south + 1e-6, lat + dLat));
      lng = Math.min(bbox.east - 1e-6, Math.max(bbox.west + 1e-6, lng + dLng));
      botSocket.emit('location-update', { lat, lng, heading });
      if (Math.random() < 0.02) botSocket.emit('player-attack', { heading });
      if (Math.random() < 0.01) botSocket.emit('player-shield');
    }, 500);
    setBots((b) => [...b, { socket: botSocket, interval }]);
  };

  useEffect(() => {
    return () => {
      for (const b of bots) {
        clearInterval(b.interval);
        b.socket.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- render -------------------------------------------------------------
  const gpsReady = Boolean(position);

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <MapView
        grid={grid}
        ownership={ownership}
        players={players}
        me={me}
        myHeading={position?.heading ?? 0}
        baseCellId={grid?.baseCellId}
        arrows={arrows}
      />

      {joined && (
        <>
          <HUD
            remainingSeconds={remainingSeconds}
            me={me}
            mySquares={mySquares}
            leaderboard={leaderboard}
          />
          <ControlPanel
            me={me}
            atBase={atBase}
            shieldUntil={shieldUntil}
            onAttack={attack}
            onShield={shield}
            onRespawn={respawn}
          />
          {simulate && (
            <SimPanel
              simPos={simPos}
              setSimPos={setSimPos}
              onSpawnBot={spawnBot}
              botCount={bots.length}
            />
          )}
        </>
      )}

      {!joined && (
        <AreaPicker
          gpsReady={gpsReady}
          simulate={simulate}
          onToggleSim={() => setSimulate((s) => !s)}
          onJoin={handleJoin}
        />
      )}
    </div>
  );
}
