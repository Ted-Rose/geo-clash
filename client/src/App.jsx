import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import { useGeolocation } from './hooks/useGeolocation.js';
import LobbyScreen from './components/LobbyScreen.jsx';
import GameScreen from './components/GameScreen.jsx';

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [connectError, setConnectError] = useState(null);
  const [roomId, setRoomId] = useState(null);

  // Lift sim/GPS state here so the Lobby and the Game share the same
  // position source. The Game also needs `simulate`/`simPos` to render the
  // Sim panel. The Lobby drives the toggle.
  const [simulate, setSimulate] = useState(false);
  const [simPos, setSimPos] = useState(null);
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
        position={position}
        onJoined={({ roomId: id }) => setRoomId(id)}
      />
    );
  }

  return (
    <GameScreen
      key={roomId}
      roomId={roomId}
      position={position}
      simulate={simulate}
      simPos={simPos}
      setSimPos={setSimPos}
      onLeave={() => setRoomId(null)}
    />
  );
}
