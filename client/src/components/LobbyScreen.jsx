import { useEffect, useMemo, useState } from 'react';
import { socket } from '../socket.js';
import { useRooms } from '../hooks/useRooms.js';

// Single mobile-first lobby screen. Lets the player set their name + GPS
// (or simulate) and either create a new room or join an existing one.
// onJoined({ roomId }) is called once the server acks a successful join.
export default function LobbyScreen({
  onJoined,
  connected,
  connectError,
  simulate,
  setSimulate,
  simPos,
  setSimPos,
  position,
}) {
  const { rooms, loading, refresh } = useRooms();
  const [name, setName] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [cellSize, setCellSize] = useState(10);
  const [squaresPerSide, setSquaresPerSide] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Seed sim position once when the user enables simulate.
  useEffect(() => {
    if (simulate && !simPos) {
      setSimPos({ lat: 52.5163, lng: 13.3777, heading: 0 });
    }
  }, [simulate, simPos, setSimPos]);
  const ready = Boolean(position) && connected && !busy;

  const sortedRooms = useMemo(
    () => [...rooms].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [rooms]
  );

  function joinRoom(roomId) {
    if (!ready) return;
    setBusy(true);
    setError(null);
    socket.emit(
      'room-join',
      {
        roomId,
        name: name.trim() || undefined,
        lat: position.lat,
        lng: position.lng,
      },
      (ack) => {
        setBusy(false);
        if (ack?.ok) onJoined({ roomId, snapshot: ack.snapshot });
        else setError(ack?.reason || 'join failed');
      }
    );
  }

  function createRoom() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    socket.emit(
      'room-create',
      {
        name: newRoomName.trim() || undefined,
        centerLat: position.lat,
        centerLng: position.lng,
        cellSize,
        squaresPerSide,
      },
      (ack) => {
        if (!ack?.ok) {
          setBusy(false);
          setError(ack?.reason || 'create failed');
          return;
        }
        // Auto-join the freshly-created room.
        socket.emit(
          'room-join',
          {
            roomId: ack.room.id,
            name: name.trim() || undefined,
            lat: position.lat,
            lng: position.lng,
          },
          (jack) => {
            setBusy(false);
            if (jack?.ok) onJoined({ roomId: ack.room.id, snapshot: jack.snapshot });
            else setError(jack?.reason || 'join failed');
          }
        );
      }
    );
  }

  return (
    <div className="absolute inset-0 z-[1000] bg-slate-900 overflow-y-auto">
      <div className="min-h-full flex items-start justify-center p-4">
        <div className="w-full max-w-md space-y-4 py-6">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">
              Parku Cīņas
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Stand in 5×5 m squares for 5 seconds to claim them. Most squares
              in 5 minutes wins.
            </p>
          </div>

          <div className="bg-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
            <label className="block">
              <span className="text-sm text-slate-300">Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Anonymous"
                className="mt-1 w-full px-3 py-3 rounded-lg bg-slate-900 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-base"
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={simulate}
                onChange={() => setSimulate((s) => !s)}
                className="w-5 h-5"
              />
              Simulate movement (desktop / no GPS)
            </label>

            {!position && !simulate && (
              <div className="text-xs text-amber-300">
                Waiting for GPS… on desktop, enable Simulate Movement above.
              </div>
            )}

            {!connected && (
              <div className="text-xs text-rose-300">
                Not connected to server
                {connectError ? ` (${connectError})` : ''}.
              </div>
            )}
          </div>

          <div className="bg-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Rooms</h2>
              <button
                onClick={refresh}
                className="text-xs text-cyan-400 hover:text-cyan-300 active:scale-95 transition"
              >
                ↻ refresh
              </button>
            </div>

            {loading && rooms.length === 0 && (
              <div className="text-sm text-slate-400">Loading…</div>
            )}
            {!loading && sortedRooms.length === 0 && (
              <div className="text-sm text-slate-400">
                No rooms yet. Create one below.
              </div>
            )}

            <ul className="space-y-2">
              {sortedRooms.map((r) => {
                const full = r.playerCount >= r.maxPlayers;
                return (
                  <li key={r.id}>
                    <button
                      disabled={!ready || full || r.status === 'ended'}
                      onClick={() => joinRoom(r.id)}
                      className="w-full flex items-center justify-between gap-3 px-3 py-3 rounded-lg bg-slate-900 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-left"
                    >
                      <span className="flex flex-col">
                        <span className="font-semibold">{r.name}</span>
                        <span className="text-xs text-slate-400">
                          {r.playerCount}/{r.maxPlayers} · {r.status}
                        </span>
                      </span>
                      <span className="text-cyan-400 font-bold">→</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="bg-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
            <h2 className="text-lg font-bold">Create new room</h2>
            <input
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Room name (optional)"
              className="w-full px-3 py-3 rounded-lg bg-slate-900 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-base"
            />
            <label className="block">
              <div className="flex justify-between text-sm text-slate-300 mb-1">
                <span>Square size</span>
                <span className="font-mono text-cyan-400">{cellSize}×{cellSize} m</span>
              </div>
              <input
                type="range"
                min={5}
                max={30}
                step={5}
                value={cellSize}
                onChange={(e) => setCellSize(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-0.5">
                <span>5 m</span>
                <span>30 m</span>
              </div>
            </label>
            <label className="block">
              <div className="flex justify-between text-sm text-slate-300 mb-1">
                <span>Square count</span>
                <span className="font-mono text-cyan-400">
                  {squaresPerSide}×{squaresPerSide} ={' '}
                  {squaresPerSide * squaresPerSide} squares
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={20}
                step={1}
                value={squaresPerSide}
                onChange={(e) => setSquaresPerSide(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-0.5">
                <span>5×5</span>
                <span>20×20</span>
              </div>
            </label>
            <button
              onClick={createRoom}
              disabled={!ready}
              className="w-full py-3 rounded-xl bg-cyan-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-slate-900 font-bold text-lg shadow active:scale-95 transition"
            >
              Create + join
            </button>
          </div>

          {error && (
            <div className="text-sm text-rose-300 bg-rose-950/50 border border-rose-800 rounded-lg p-3">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
