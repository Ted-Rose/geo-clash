import { useEffect, useRef, useState } from 'react';
import { getSocket, getSessionId } from './socket.js';
import { useGeolocation } from './hooks/useGeolocation.js';
import LobbyScreen from './components/LobbyScreen.jsx';
import ClashGameScreen from './components/GameScreen.jsx';
import SnakeGameScreen from './snake/GameScreen.jsx';

const GAME_SCREENS = {
  clash: ClashGameScreen,
  snake: SnakeGameScreen,
};

export default function App() {
  const socket = getSocket();
  const [connected, setConnected] = useState(socket.connected);
  const [connectError, setConnectError] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [room, setRoom] = useState(null);
  const [initialSnapshot, setInitialSnapshot] = useState(null);
  const [reconnectSnap, setReconnectSnap] = useState(null);
  const [rejoining, setRejoining] = useState(false);
  const rejoinRef = useRef(null);

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
    function onConnect() {
      setConnected(true);
      setConnectError(null);
      // If we were in a game when the connection dropped, auto-rejoin.
      const rj = rejoinRef.current;
      if (rj) {
        setRejoining(true);
        socket.emit(
          'room-join',
          { roomId: rj.roomId, name: rj.name, sessionId: rj.sessionId },
          (result) => {
            setRejoining(false);
            if (!result?.ok) {
              // Game ended or room gone — go back to lobby.
              rejoinRef.current = null;
              setRoomId(null);
              setRoom(null);
              setInitialSnapshot(null);
              setReconnectSnap(null);
            } else {
              // Push the snapshot directly so GameScreen unfreezes
              // immediately without depending on the separately-emitted
              // 'snapshot' event arriving at the right time.
              setReconnectSnap({
                id: socket.id,
                snapshot: result.snapshot,
              });
            }
          },
        );
      }
    }
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
        onJoined={({ roomId: id, room: r, snapshot, name }) => {
          const sessionId = getSessionId();
          rejoinRef.current = { roomId: id, name, sessionId, room: r };
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
      reconnectSnap={reconnectSnap}
      connected={connected && !rejoining}
      onLeave={() => {
        rejoinRef.current = null;
        setRoomId(null);
        setRoom(null);
      }}
    />
  );
}
