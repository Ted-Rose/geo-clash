import { useEffect, useState } from 'react';
import { getSocket, getSessionId } from './socket.js';
import { useRooms } from './hooks/useRooms.js';
import RoomCreateForm from './RoomCreateForm.jsx';
import RoomList from './RoomList.jsx';

// Single mobile-first lobby screen. Lets the player set their name + GPS
// (or simulate) and either create a new room or join an existing one.
// onJoined({ roomId }) is called once the server acks a successful join.
export default function LobbyScreen({
  onJoined,
  connected,
  simulate,
  setSimulate,
  simPos,
  setSimPos,
  maxImageryAge,
  setMaxImageryAge,
  maxNativeZoom,
  setMaxNativeZoom,
  position,
  connectError,
}) {
  const socket = getSocket();
  const { rooms, loading, refresh } = useRooms();
  const [name, setName] = useState(
    () => localStorage.getItem('playerName') || ''
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Seed sim position once when the user enables simulate.
  useEffect(() => {
    if (simulate && !simPos) {
      setSimPos({ lat: 52.5163, lng: 13.3777, heading: 0 });
    }
  }, [simulate, simPos, setSimPos]);
  const ready = Boolean(position) && connected && !busy;

  function joinRoom(roomId) {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const trimmedName = name.trim() || undefined;
    socket.emit(
      'room-join',
      {
        roomId,
        name: trimmedName,
        lat: position.lat,
        lng: position.lng,
        sessionId: getSessionId(),
      },
      (ack) => {
        setBusy(false);
        if (ack?.ok) onJoined({
          roomId,
          room: ack.room || rooms.find((r) => r.id === roomId),
          snapshot: ack.snapshot,
          name: trimmedName,
        });
        else {
          setError(ack?.reason || 'join failed');
          if (ack?.reason === 'no-such-room' || ack?.reason === 'ended') {
            refresh();
          }
        }
      }
    );
  }

  // The form supplies the room options; the center always comes from the
  // player's current position. Auto-joins the freshly-created room.
  function createRoom(formValues) {
    if (!ready) return;
    setBusy(true);
    setError(null);
    socket.emit(
      'room-create',
      {
        centerLat: position.lat,
        centerLng: position.lng,
        ...formValues,
      },
      (ack) => {
        if (!ack?.ok) {
          setBusy(false);
          setError(ack?.reason || 'create failed');
          return;
        }
        // Auto-join the freshly-created room.
        const trimmedName = name.trim() || undefined;
        socket.emit(
          'room-join',
          {
            roomId: ack.room.id,
            name: trimmedName,
            lat: position.lat,
            lng: position.lng,
            sessionId: getSessionId(),
          },
          (jack) => {
            setBusy(false);
            if (jack?.ok) onJoined({
              roomId: ack.room.id,
              room: ack.room,
              snapshot: jack.snapshot,
              name: trimmedName,
            });
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
              Stand in 5×5 m squares for 5 seconds to claim them. Most
              squares in 5 minutes wins.
            </p>
          </div>

          <div className="bg-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
            <label className="block">
              <span className="text-sm text-slate-300">Your name</span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  localStorage.setItem('playerName', e.target.value);
                }}
                placeholder="Anonymous"
                className="mt-1 w-full px-3 py-3 rounded-lg bg-slate-900
                           border border-slate-700 focus:outline-none
                           focus:ring-2 focus:ring-cyan-500 text-base"
              />
            </label>

            <label
              className="flex items-center gap-2 text-sm text-slate-300"
            >
              <input
                type="checkbox"
                checked={simulate}
                onChange={() => setSimulate((s) => !s)}
                className="w-5 h-5"
              />
              Simulate movement (desktop / no GPS)
            </label>

            <label className="block border-t border-slate-700 pt-3">
              <div
                className="flex justify-between text-sm text-slate-300
                           mb-1"
              >
                <span>Max Imagery Age</span>
                <span className="font-mono text-cyan-400">
                  {maxImageryAge} years
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={20}
                step={1}
                value={maxImageryAge}
                onChange={(e) => setMaxImageryAge(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
              <div
                className="text-[10px] text-slate-500 mt-1 leading-tight"
              >
                Blocks high-res imagery older than {maxImageryAge} years.
              </div>
            </label>

            <label className="block border-t border-slate-700 pt-3">
              <div
                className="flex justify-between text-sm text-slate-300
                           mb-1"
              >
                <span>Max Map Detail</span>
                <span className="font-mono text-cyan-400">
                  Zoom {maxNativeZoom}
                </span>
              </div>
              <input
                type="range"
                min={15}
                max={19}
                step={1}
                value={maxNativeZoom}
                onChange={(e) => setMaxNativeZoom(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
              <div
                className="text-[10px] text-slate-500 mt-1 leading-tight"
              >
                Lower this if high-res imagery is outdated.
                The map will "overzoom" newer, lower-res tiles instead.
              </div>
            </label>

            {!position && !simulate && (
              <div className="text-xs text-amber-300">
                Waiting for GPS… on desktop, enable Simulate Movement
                above.
              </div>
            )}

            {!connected && (
              <div className="text-xs text-rose-300">
                Not connected to server
                {connectError ? ` (${connectError})` : ''}.
              </div>
            )}
          </div>

          <RoomList
            rooms={rooms}
            loading={loading}
            ready={ready}
            onJoin={joinRoom}
            onRefresh={refresh}
          />

          <RoomCreateForm ready={ready} onCreate={createRoom} />

          {error && (
            <div
              className="text-sm text-rose-300 bg-rose-950/50 border
                         border-rose-800 rounded-lg p-3"
            >
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
