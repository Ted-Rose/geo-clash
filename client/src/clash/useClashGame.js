import { useEffect, useMemo, useRef, useState } from "react";
import { useSound } from "../shared/hooks/useSound.js";
import { getSocket, API_BASE } from "../shared/socket.js";

// Socket subscriptions + gameplay state for the clash GameScreen.
// Owns every socket.on/off wiring, the snapshot-apply paths, and the
// server-driven state setters; returns a flat render-state object so the
// component stays render + input only. No game logic lives here — the
// client remains a dumb renderer of server state.
export function useClashGame({
  roomId,
  position,
  initialSnapshot,
  reconnectSnap,
}) {
  const socket = getSocket();
  const [myId, setMyId] = useState(() => socket.id);
  const {
    playCaptureStart,
    playCaptureOwned,
    playShoot,
    playEnemyShoot,
    playShield,
  } = useSound();
  // State declarations first
  const [grid, setGrid] = useState(null);
  const [ownership, setOwnership] = useState([]);
  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState({});
  const [remainingSeconds, setRemainingSeconds] = useState(300);
  const [shieldUntil, setShieldUntil] = useState(0);
  const [projectiles, setProjectiles] = useState([]);
  const [skewMs, setSkewMs] = useState(0);
  const [matchEnded, setMatchEnded] = useState(false);
  const [finalLeaderboard, setFinalLeaderboard] = useState(null);
  const [globalTop, setGlobalTop] = useState(null);
  const [ammo, setAmmo] = useState(null);
  const [maxAmmo, setMaxAmmo] = useState(null);

  // Refs and their effects
  const myIdRef = useRef(myId);
  useEffect(() => {
    myIdRef.current = myId;
  }, [myId]);
  const positionRef = useRef(position);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);
  const playersRef = useRef([]);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  // Apply the snapshot that arrived in the room-join ack (before this
  // component mounted, so the socket events were already missed).
  useEffect(() => {
    if (!initialSnapshot) return;
    const s = initialSnapshot;
    if (s.grid) setGrid(s.grid);
    if (s.ownership) setOwnership(s.ownership);
    if (s.players) setPlayers(s.players);
    if (s.scores) setScores(s.scores);
    if (typeof s.remainingSeconds === "number")
      setRemainingSeconds(s.remainingSeconds);
    if (Array.isArray(s.projectiles)) setProjectiles(s.projectiles);
    if (typeof s.serverNow === "number") setSkewMs(s.serverNow - Date.now());
    if (typeof s.maxAmmo === "number") setMaxAmmo(s.maxAmmo);
    const meSnap = s.players?.find((p) => p.id === socket.id);
    if (meSnap && typeof meSnap.ammo === "number") setAmmo(meSnap.ammo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On reconnect: apply the fresh snapshot pushed from the ack and update
  // myId to the new socket ID so HUD and actions target the right player.
  useEffect(() => {
    if (!reconnectSnap) return;
    if (reconnectSnap.id) setMyId(reconnectSnap.id);
    const s = reconnectSnap.snapshot;
    if (!s) return;
    if (s.grid) setGrid(s.grid);
    if (s.ownership) setOwnership(s.ownership);
    if (s.players) setPlayers(s.players);
    if (s.scores) setScores(s.scores);
    if (typeof s.remainingSeconds === "number")
      setRemainingSeconds(s.remainingSeconds);
    if (Array.isArray(s.projectiles)) setProjectiles(s.projectiles);
    if (typeof s.serverNow === "number") setSkewMs(s.serverNow - Date.now());
    if (typeof s.maxAmmo === "number") setMaxAmmo(s.maxAmmo);
    const meSnap = s.players?.find((p) => p.id === reconnectSnap.id);
    if (meSnap && typeof meSnap.ammo === "number") setAmmo(meSnap.ammo);
  }, [reconnectSnap]);

  // Wire socket events for the active room.
  useEffect(() => {
    function onSnapshot(s) {
      if (s.grid) setGrid(s.grid);
      if (s.ownership) setOwnership(s.ownership);
      if (s.players) setPlayers(s.players);
      if (s.scores) setScores(s.scores);
      if (typeof s.remainingSeconds === "number") {
        setRemainingSeconds(s.remainingSeconds);
      }
      if (Array.isArray(s.projectiles)) setProjectiles(s.projectiles);
      if (typeof s.serverNow === "number") {
        // First-cut skew estimate from the snapshot, refined by `time-sync`.
        setSkewMs(s.serverNow - Date.now());
      }
    }
    function onJoined({ id }) {
      setMyId(id);
    }
    function onPlayers({ players: ps }) {
      setPlayers(ps);
    }
    function onGrid({ cells, scores: sc }) {
      setOwnership((prev) => {
        const m = new Map(prev.map((c) => [c.id, c]));
        for (const c of cells) m.set(c.id, c);
        return [...m.values()];
      });
      if (sc) setScores(sc);
      if (cells.some((c) => c.ownerId === myIdRef.current)) {
        playCaptureOwned();
      }
    }
    function onCaptureStart({ playerId }) {
      if (playerId === myIdRef.current) playCaptureStart();
    }
    function onTimer({ remainingSeconds: rs }) {
      setRemainingSeconds(rs);
    }
    function onShield({ id, until }) {
      if (id === socket.id) {
        setShieldUntil(until);
        playShield();
      }
    }
    function onShieldEnd({ id }) {
      if (id === socket.id) setShieldUntil(0);
    }
    function onProjectileSpawn(p) {
      setProjectiles((prev) => [...prev, p]);
      if (p.attackerId === myIdRef.current) {
        playShoot(p.attackerId);
      } else {
        const me =
          playersRef.current.find((pl) => pl.id === myIdRef.current) ||
          positionRef.current;
        if (me && distDeg(me, p.target) <= ENEMY_SHOT_NEAR_DEG) {
          playEnemyShoot(p.attackerId);
        }
      }
    }
    function onProjectileResolved({ id }) {
      setProjectiles((prev) => prev.filter((p) => p.id !== id));
    }
    function onMatchEnd({ leaderboard } = {}) {
      setMatchEnded(true);
      if (Array.isArray(leaderboard)) setFinalLeaderboard(leaderboard);
      // Pull the global top-N so the post-match screen can show where this
      // match sits in the all-time list.
      fetch(`${API_BASE}/api/leaderboard?limit=10`)
        .then((r) => (r.ok ? r.json() : { top: [] }))
        .then((data) => setGlobalTop(data.top || []))
        .catch(() => setGlobalTop([]));
    }

    function onAmmoUpdate({ ammo: a, maxAmmo: m }) {
      setAmmo(a);
      setMaxAmmo(m);
    }
    socket.on("snapshot", onSnapshot);
    socket.on("joined", onJoined);
    socket.on("players-update", onPlayers);
    socket.on("grid-update", onGrid);
    socket.on("cell-capture-start", onCaptureStart);
    socket.on("timer", onTimer);
    socket.on("player-shield", onShield);
    socket.on("player-shield-end", onShieldEnd);
    socket.on("projectile-spawn", onProjectileSpawn);
    socket.on("projectile-resolved", onProjectileResolved);
    socket.on("match-end", onMatchEnd);
    socket.on("ammo-update", onAmmoUpdate);

    return () => {
      socket.off("snapshot", onSnapshot);
      socket.off("joined", onJoined);
      socket.off("players-update", onPlayers);
      socket.off("grid-update", onGrid);
      socket.off("cell-capture-start", onCaptureStart);
      socket.off("timer", onTimer);
      socket.off("player-shield", onShield);
      socket.off("player-shield-end", onShieldEnd);
      socket.off("projectile-spawn", onProjectileSpawn);
      socket.off("projectile-resolved", onProjectileResolved);
      socket.off("match-end", onMatchEnd);
      socket.off("ammo-update", onAmmoUpdate);
    };
  }, [roomId]);

  // Refine clock skew with a round-trip measurement at mount + reconnect.
  useEffect(() => {
    function syncOnce() {
      const send = Date.now();
      socket.emit("time-sync", send, (resp) => {
        if (!resp) return;
        const recv = Date.now();
        const rtt = recv - send;
        // skew = serverNow - clientMidpoint
        const skew = resp.serverNowMs - (send + rtt / 2);
        setSkewMs(skew);
      });
    }
    if (socket.connected) syncOnce();
    socket.on("connect", syncOnce);
    return () => {
      socket.off("connect", syncOnce);
    };
  }, []);

  const me = useMemo(
    () => players.find((p) => p.id === myId) || null,
    [players, myId],
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
      position.lat >= south &&
      position.lat <= north &&
      position.lng >= west &&
      position.lng <= east
    );
  }, [grid, position]);

  return {
    myId,
    grid,
    ownership,
    players,
    me,
    mySquares,
    leaderboard,
    atBase,
    remainingSeconds,
    shieldUntil,
    projectiles,
    skewMs,
    ammo,
    maxAmmo,
    matchEnded,
    finalLeaderboard,
    globalTop,
  };
}

const ENEMY_SHOT_NEAR_DEG = 0.00015; // ~15 m in degrees

function distDeg(a, b) {
  const dLat = a.lat - b.lat;
  const dLng = a.lng - b.lng;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}
