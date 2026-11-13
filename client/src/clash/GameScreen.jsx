import { useEffect, useRef, useState } from "react";
import { CircleMarker, Tooltip } from "react-leaflet";
import { getSocket } from "../shared/socket.js";
import { useClashGame } from "./useClashGame.js";
import MapView from "../shared/MapView.jsx";
import GameMenu from "../shared/GameMenu.jsx";
import ProjectileLayer from "./ProjectileLayer.jsx";
import HUD from "./HUD.jsx";
import ControlPanel from "./ControlPanel.jsx";
import SimPanel from "./SimPanel.jsx";
import PostMatchScreen from "./PostMatchScreen.jsx";

// In-game shell. Socket subscriptions + server-driven state live in
// useClashGame; this component is render + input only. Leaving the room
// cleanly unsubscribes and clears local state.
export default function GameScreen({
  roomId,
  position,
  simulate,
  simPos,
  setSimPos,
  maxImageryAge,
  maxNativeZoom,
  initialSnapshot,
  reconnectSnap,
  connected,
  onLeave,
}) {
  const socket = getSocket();
  const {
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
  } = useClashGame({ roomId, position, initialSnapshot, reconnectSnap });

  // Local input/UI state — not server-driven.
  // target: { lat, lng } picked via long-press
  const [target, setTarget] = useState(null);
  // Bot handles live in a ref so the unmount cleanup always sees every
  // spawned bot (a `[]` deps effect over state would close over the
  // initial empty array). `botCount` mirrors the length for render.
  const botsRef = useRef([]);
  const unmountedRef = useRef(false);
  const [botCount, setBotCount] = useState(0);
  const [mapLocked, setMapLocked] = useState(true);

  // Stream our position to the server (rate-limited).
  const lastSentRef = useRef(0);
  useEffect(() => {
    if (!position) return;
    const now = Date.now();
    if (now - lastSentRef.current < 250) return;
    lastSentRef.current = now;
    socket.emit("location-update", {
      lat: position.lat,
      lng: position.lng,
      heading: position.heading ?? 0,
    });
  }, [position]);

  // Menu rows: every player tagged with their captured-squares score.
  const squaresById = new Map(
    leaderboard.map((r) => [r.id, r.squares]),
  );
  const menuPlayers = players.map((p) => ({
    ...p,
    alive: p.alive !== false,
    score: squaresById.get(p.id) ?? 0,
  }));

  const attack = () => {
    socket.emit("player-attack", {
      heading: position?.heading ?? 0,
      target: target || undefined,
    });
  };
  const shield = () => socket.emit("player-shield");
  const respawn = () => socket.emit("player-respawn");

  // Bots: extra socket.io connections from this tab — handy for testing.
  const spawnBot = async () => {
    if (!grid) return;
    const { io } = await import("socket.io-client");
    const { bbox } = grid;
    const botSocket = io("/", { transports: ["websocket", "polling"] });
    // Number the bot now: the connect handler runs after the sync
    // push below, where `length + 1` would already count this bot.
    const botNo = botsRef.current.length + 1;
    let lat = bbox.south + Math.random() * (bbox.north - bbox.south);
    let lng = bbox.west + Math.random() * (bbox.east - bbox.west);
    let heading = Math.random() * 360;
    botSocket.on("connect", () => {
      botSocket.emit("room-join", {
        roomId,
        name: `Bot-${botNo}`,
        lat,
        lng,
      });
    });
    const interval = setInterval(() => {
      heading += (Math.random() - 0.5) * 30;
      const φ = (lat * Math.PI) / 180;
      const stepM = 2 + Math.random() * 3;
      const dLat = (stepM / 111320) * Math.cos((heading * Math.PI) / 180);
      const dLng =
        (stepM / (111320 * Math.cos(φ))) *
        Math.sin((heading * Math.PI) / 180);
      lat = Math.min(
        bbox.north - 1e-6,
        Math.max(bbox.south + 1e-6, lat + dLat),
      );
      lng = Math.min(
        bbox.east - 1e-6,
        Math.max(bbox.west + 1e-6, lng + dLng),
      );
      botSocket.emit("location-update", { lat, lng, heading });
      if (Math.random() < 0.02) botSocket.emit("player-attack", { heading });
      if (Math.random() < 0.01) botSocket.emit("player-shield");
    }, 500);
    // Unmounted while the import was in flight — tear the bot down
    // instead of pushing it past the already-run cleanup.
    if (unmountedRef.current) {
      clearInterval(interval);
      botSocket.disconnect();
      return;
    }
    botsRef.current.push({ socket: botSocket, interval });
    setBotCount(botsRef.current.length);
  };

  // Cleanup bots + leave room on unmount.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      socket.emit("room-leave");
      for (const b of botsRef.current) {
        clearInterval(b.interval);
        b.socket.disconnect();
      }
      botsRef.current = [];
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
        maxImageryAge={maxImageryAge}
        maxNativeZoom={maxNativeZoom}
      >
        <ProjectileLayer projectiles={projectiles} skewMs={skewMs} />
        {target && (
          <CircleMarker
            center={[target.lat, target.lng]}
            radius={6}
            pathOptions={{
              color: "#facc15",
              weight: 2,
              fillColor: "#facc15",
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
        ammo={ammo}
        maxAmmo={maxAmmo}
      />

      <GameMenu
        onLeave={onLeave}
        players={menuPlayers}
        myId={myId}
      >
        <label
          className="flex items-center gap-2 px-3 py-2 rounded-lg
                     hover:bg-slate-700 cursor-pointer text-base
                     text-slate-200 select-none"
        >
          <input
            type="checkbox"
            checked={mapLocked}
            onChange={(e) => setMapLocked(e.target.checked)}
            className="w-4 h-4 accent-cyan-400"
          />
          Lock map view
        </label>
      </GameMenu>

      <ControlPanel
        me={me}
        atBase={atBase}
        shieldUntil={shieldUntil}
        onAttack={attack}
        onShield={shield}
        onRespawn={respawn}
        ammo={ammo}
        maxAmmo={maxAmmo}
      />

      {simulate && (
        <SimPanel
          simPos={simPos}
          setSimPos={setSimPos}
          onSpawnBot={spawnBot}
          botCount={botCount}
          onAttackAtTarget={attack}
          hasTarget={Boolean(target)}
        />
      )}

      {target && (
        <button
          onClick={() => setTarget(null)}
          className="absolute top-3 right-3 z-[600] bg-yellow-400/90
                     text-slate-900 rounded-full px-3 py-1 text-xs
                     font-semibold shadow-lg active:scale-95 transition"
        >
          ✕ clear target
        </button>
      )}

      {!connected && !matchEnded && (
        <div
          className="fixed inset-0 z-[700] bg-slate-900/60
                     backdrop-blur-sm flex items-center justify-center"
        >
          <div
            className="bg-slate-800 rounded-2xl px-6 py-4 text-white
                       text-center shadow-2xl"
          >
            <div className="text-lg font-semibold mb-1">Reconnecting…</div>
            <div className="text-sm text-slate-400">Your game is saved</div>
          </div>
        </div>
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
