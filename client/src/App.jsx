import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import { useGeolocation } from './hooks/useGeolocation.js';
import LobbyScreen from './components/LobbyScreen.jsx';
import ClashGameScreen from './clash/GameScreen.jsx';
import SnakeGameScreen from './snake/GameScreen.jsx';

const GAME_SCREENS = {
  clash: ClashGameScreen,
  snake: SnakeGameScreen,
};

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [connectError, setConnectError] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [room, setRoom] = useState(null);
  const [initialSnapshot, setInitialSnapshot] = useState(null);

  // Lift sim/GPS state here so the Lobby and the Game share the same
  // position source. The Game also needs `simulate`/`simPos` to render the
  // Lobby drives the toggle.
  const [simulate, setSimulate] = useState(false);
  const [simPos, setSimPos] = useState(null);

  const [maxImageryAge, _setMaxImageryAge] = useState(() => {
    const saved = localStorage.getItem('maxImageryAge');
    return saved ? parseInt(saved, 10) : 3;
  });

  const setMaxImageryAge = (val) => {
    _setMaxImageryAge(val);
    localStorage.setItem('maxImageryAge', val);
  };

  const [maxNativeZoom, _setMaxNativeZoom] = useState(() => {
    const saved = localStorage.getItem('maxNativeZoom');
    return saved ? parseInt(saved, 10) : 18;
  });

  const setMaxNativeZoom = (val) => {
    _setMaxNativeZoom(val);
    localStorage.setItem('maxNativeZoom', val);
  };

  const { position: gpsPos } = useGeolocation({

    enabled: !simulate,
    simulated: simulate ? simPos : null,
  });
  const position = simulate ? simPos : gpsPos;

  useEffect(() => {
    function onConnect() { setConnected(true); setConnectError(null); }
    function onDisconnect() { setConnected(false); }
    function onError(err) {
      setConnected(false);
      setConnectError(err?.message || 'connect error');
      // eslint-disable-next-line no-console
      console.error('[geo-clash] socket connect_error:', err);
    }
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onError);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onError);
    };
  }, []);

  if (!roomId) {
    return (
      <LobbyScreen
        connected={connected}
        connectError={connectError}
        simulate={simulate}
        setSimulate={setSimulate}
        simPos={simPos}
        setSimPos={setSimPos}
        maxImageryAge={maxImageryAge}
        setMaxImageryAge={setMaxImageryAge}
        maxNativeZoom={maxNativeZoom}
        setMaxNativeZoom={setMaxNativeZoom}
        position={position}
        onJoined={({ roomId: id, room: r, snapshot }) => {
          setInitialSnapshot(snapshot || null);
          setRoomId(id);
          setRoom(r || null);
        }}
      />
    );
  }

  const GameScreen = GAME_SCREENS[room?.gameType] || ClashGameScreen;
  return (
    <GameScreen
      key={roomId}
      roomId={roomId}
      room={room}
      position={position}
      simulate={simulate}
      simPos={simPos}
      setSimPos={setSimPos}
      maxImageryAge={maxImageryAge}
      maxNativeZoom={maxNativeZoom}
      initialSnapshot={initialSnapshot}
      onLeave={() => { setRoomId(null); setRoom(null); }}
    />
  );
}
