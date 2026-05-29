import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { CircleMarker, Tooltip } from 'react-leaflet';
import { socket } from '../socket.js';
import MapView from './MapView.jsx';
import HUD from './HUD.jsx';
import ControlPanel from './ControlPanel.jsx';
import SimPanel from './SimPanel.jsx';
import ProjectileLayer from './ProjectileLayer.jsx';
import PostMatchScreen from './PostMatchScreen.jsx';

// In-game shell. All socket subscriptions are scoped to the lifetime of
// this component (i.e. while a roomId is set). Leaving the room cleanly
// unsubscribes and clears local state.
export default function GameScreen({ roomId, position, simulate, simPos, setSimPos, initialSnapshot, onLeave }) {
  const [myId, setMyId] = useState(() => socket.id);
  const [grid, setGrid] = useState(null);
  const [ownership, setOwnership] = useState([]);
  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState({});
  const [remainingSeconds, setRemainingSeconds] = useState(300);
  const [shieldUntil, setShieldUntil] = useState(0);
  const [projectiles, setProjectiles] = useState([]);
  const [skewMs, setSkewMs] = useState(0);
  const [target, setTarget] = useState(null); // { lat, lng } picked via long-press
  const [bots, setBots] = useState([]);
  const [matchEnded, setMatchEnded] = useState(false);
  const [finalLeaderboard, setFinalLeaderboard] = useState(null);
  const [globalTop, setGlobalTop] = useState(null);
  const [mapLocked, setMapLocked] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  // Apply the snapshot that arrived in the room-join ack (before this
  // component mounted, so the socket events were already missed).
  useEffect(() => {
    if (!initialSnapshot) return;
    const s = initialSnapshot;
    if (s.grid) setGrid(s.grid);
    if (s.ownership) setOwnership(s.ownership);
    if (s.players) setPlayers(s.players);
    if (s.scores) setScores(s.scores);
    if (typeof s.remainingSeconds === 'number') setRemainingSeconds(s.remainingSeconds);
    if (Array.isArray(s.projectiles)) setProjectiles(s.projectiles);
    if (typeof s.serverNow === 'number') setSkewMs(s.serverNow - Date.now());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wire socket events for the active room.
  useEffect(() => {
    function onSnapshot(s) {
      if (s.grid) setGrid(s.grid);
      if (s.ownership) setOwnership(s.ownership);
      if (s.players) setPlayers(s.players);
      if (s.scores) setScores(s.scores);
      if (typeof s.remainingSeconds === 'number') {
        setRemainingSeconds(s.remainingSeconds);
      }
      if (Array.isArray(s.projectiles)) setProjectiles(s.projectiles);
      if (typeof s.serverNow === 'number') {
        // First-cut skew estimate from the snapshot, refined by `time-sync`.
        setSkewMs(s.serverNow - Date.now());
      }
    }
    function onJoined({ id }) { setMyId(id); }
    function onPlayers({ players: ps }) { setPlayers(ps); }
    function onGrid({ cells, scores: sc }) {
      setOwnership((prev) => {
        const m = new Map(prev.map((c) => [c.id, c]));
        for (const c of cells) m.set(c.id, c);
        return [...m.values()];
      });
      if (sc) setScores(sc);
    }
    function onTimer({ remainingSeconds: rs }) { setRemainingSeconds(rs); }
    function onShield({ id, until }) {
      if (id === socket.id) setShieldUntil(until);
    }
    function onShieldEnd({ id }) {
      if (id === socket.id) setShieldUntil(0);
    }
    function onProjectileSpawn(p) {
      setProjectiles((prev) => [...prev, p]);
    }
    function onProjectileResolved({ id }) {
      setProjectiles((prev) => prev.filter((p) => p.id !== id));
    }
    function onMatchEnd({ leaderboard } = {}) {
      setMatchEnded(true);
      if (Array.isArray(leaderboard)) setFinalLeaderboard(leaderboard);
      // Pull the global top-N so the post-match screen can show where this
      // match sits in the all-time list.
      fetch('/api/leaderboard?limit=10')
        .then((r) => (r.ok ? r.json() : { top: [] }))
        .then((data) => setGlobalTop(data.top || []))
        .catch(() => setGlobalTop([]));
    }

    socket.on('snapshot', onSnapshot);
    socket.on('joined', onJoined);
    socket.on('players-update', onPlayers);
    socket.on('grid-update', onGrid);
    socket.on('timer', onTimer);
    socket.on('player-shield', onShield);
    socket.on('player-shield-end', onShieldEnd);
    socket.on('projectile-spawn', onProjectileSpawn);
    socket.on('projectile-resolved', onProjectileResolved);
    socket.on('match-end', onMatchEnd);

    return () => {
      socket.off('snapshot', onSnapshot);
      socket.off('joined', onJoined);
      socket.off('players-update', onPlayers);
      socket.off('grid-update', onGrid);
      socket.off('timer', onTimer);
      socket.off('player-shield', onShield);
      socket.off('player-shield-end', onShieldEnd);
      socket.off('projectile-spawn', onProjectileSpawn);
      socket.off('projectile-resolved', onProjectileResolved);
      socket.off('match-end', onMatchEnd);
    };
  }, [roomId]);

  // Refine clock skew with a round-trip measurement at mount + reconnect.
  useEffect(() => {
    function syncOnce() {
      const send = Date.now();
      socket.emit('time-sync', send, (resp) => {
        if (!resp) return;
        const recv = Date.now();
        const rtt = recv - send;
        // skew = serverNow - clientMidpoint
        const skew = resp.serverNowMs - (send + rtt / 2);
        setSkewMs(skew);
      });
    }
    if (socket.connected) syncOnce();
    socket.on('connect', syncOnce);
    return () => { socket.off('connect', syncOnce); };
  }, []);

  // Stream our position to the server (rate-limited).
  const lastSentRef = useRef(0);
  useEffect(() => {
    if (!position) return;
    const now = Date.now();
    if (now - lastSentRef.current < 250) return;
    lastSentRef.current = now;
    socket.emit('location-update', {
      lat: position.lat,
      lng: position.lng,
      heading: position.heading ?? 0,
    });
  }, [position]);

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

  const atBase = useMemo(() => {
    if (!grid || !position) return false;
    const cell = grid.cells.find((c) => c.id === grid.baseCellId);
    if (!cell) return false;
    const [a, b, , d] = cell.polygon;
    const south = a[0];
    const west = a[1];
    const east = b[1];
    const north = d[0];
    return (
      position.lat >= south && position.lat <= north &&
      position.lng >= west && position.lng <= east
    );
  }, [grid, position]);

  const attack = () => {
    socket.emit('player-attack', {
      heading: position?.heading ?? 0,
      target: target || undefined,
    });
  };
  const shield = () => socket.emit('player-shield');
  const respawn = () => socket.emit('player-respawn');

  // Bots: extra socket.io connections from this tab — convenient for testing.
  const spawnBot = () => {
    if (!grid) return;
    const { bbox } = grid;
    const botSocket = io('/', { transports: ['websocket', 'polling'] });
    let lat = bbox.south + Math.random() * (bbox.north - bbox.south);
    let lng = bbox.west + Math.random() * (bbox.east - bbox.west);
    let heading = Math.random() * 360;
    botSocket.on('connect', () => {
      botSocket.emit('room-join', {
        roomId,
        name: `Bot-${bots.length + 1}`,
        lat, lng,
      });
    });
    const interval = setInterval(() => {
      heading += (Math.random() - 0.5) * 30;
      const φ = (lat * Math.PI) / 180;
      const stepM = 2 + Math.random() * 3;
      const dLat = (stepM / 111320) * Math.cos((heading * Math.PI) / 180);
      const dLng = (stepM / (111320 * Math.cos(φ))) * Math.sin((heading * Math.PI) / 180);
      lat = Math.min(bbox.north - 1e-6, Math.max(bbox.south + 1e-6, lat + dLat));
      lng = Math.min(bbox.east - 1e-6, Math.max(bbox.west + 1e-6, lng + dLng));
      botSocket.emit('location-update', { lat, lng, heading });
      if (Math.random() < 0.02) botSocket.emit('player-attack', { heading });
      if (Math.random() < 0.01) botSocket.emit('player-shield');
    }, 500);
    setBots((b) => [...b, { socket: botSocket, interval }]);
  };

  // Cleanup bots + leave room on unmount.
  useEffect(() => {
    return () => {
      socket.emit('room-leave');
      for (const b of bots) {
        clearInterval(b.interval);
        b.socket.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <MapView
        grid={grid}
        ownership={ownership}
        players={players}
        me={me}
        myHeading={position?.heading ?? 0}
        baseCellId={grid?.baseCellId}
        onMapLongPress={(latlng) => setTarget(latlng)}
        mapLocked={mapLocked}
      >
        <ProjectileLayer projectiles={projectiles} skewMs={skewMs} />
        {target && (
          <CircleMarker
            center={[target.lat, target.lng]}
            radius={6}
            pathOptions={{
              color: '#facc15',
              weight: 2,
              fillColor: '#facc15',
              fillOpacity: 0.6,
            }}
          >
            <Tooltip permanent direction="top" offset={[0, -8]}>
              <span className="text-xs">target</span>
            </Tooltip>
          </CircleMarker>
        )}
      </MapView>

      <HUD
        remainingSeconds={remainingSeconds}
        me={me}
        mySquares={mySquares}
        leaderboard={leaderboard}
      />

      {/* Click-outside overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-[600]"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Burger menu */}
      <div className="absolute top-3 left-3 z-[601]">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="w-11 h-11 flex items-center justify-center bg-slate-900/85 backdrop-blur rounded-xl shadow-lg text-slate-200 text-xl active:scale-95 transition"
          aria-label="Menu"
        >
          ☰
        </button>
        {menuOpen && (
          <div className="mt-2 bg-slate-900/95 backdrop-blur rounded-xl shadow-xl p-2 flex flex-col gap-1 min-w-[160px]">
            <button
              onClick={() => { setMenuOpen(false); onLeave(); }}
              className="w-full text-left px-3 py-2 rounded-lg text-slate-200 hover:bg-slate-700 active:scale-95 transition text-sm"
            >
              ⤺ Leave
            </button>
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-700 cursor-pointer text-sm text-slate-200 select-none">
              <input
                type="checkbox"
                checked={mapLocked}
                onChange={(e) => setMapLocked(e.target.checked)}
                className="w-4 h-4 accent-cyan-400"
              />
              Lock map view
            </label>
          </div>
        )}
      </div>

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
          onAttackAtTarget={attack}
          hasTarget={Boolean(target)}
        />
      )}

      {target && (
        <button
          onClick={() => setTarget(null)}
          className="absolute top-3 right-3 z-[600] bg-yellow-400/90 text-slate-900 rounded-full px-3 py-1 text-xs font-semibold shadow-lg active:scale-95 transition"
        >
          ✕ clear target
        </button>
      )}

      {matchEnded && (
        <PostMatchScreen
          finalLeaderboard={finalLeaderboard || leaderboard}
          globalTop={globalTop}
          onLeave={onLeave}
        />
      )}
    </div>
  );
}
