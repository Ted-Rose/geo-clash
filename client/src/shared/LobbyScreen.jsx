import { useEffect, useState } from 'react';
import { getSocket, getSessionId } from './socket.js';
import { useRooms } from './hooks/useRooms.js';
import RoomCreateForm from './RoomCreateForm.jsx';
import RoomList from './RoomList.jsx';

// Material "settings" gear glyph, split at path-command boundaries to
// keep every source line short.
const GEAR_ICON_PATH = [
  'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94',
  'l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22',
  'l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41',
  'h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94',
  'l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61',
  'l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94',
  'l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22',
  'l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84',
  'c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94',
  'l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61',
  'l-2.01-1.58z',
  'M12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6',
  '-1.62 3.6-3.6 3.6z',
].join(' ');

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
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // Settings dropdown — anchored to the gear button in the header.
  const settingsPanel = settingsOpen && (
    <div
      className="absolute right-0 mt-2 w-72 bg-slate-800 rounded-2xl
                 p-4 space-y-3 shadow-xl border border-slate-700"
    >
      <div className="text-sm font-semibold text-slate-200">
        Settings
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={simulate}
          onChange={() => setSimulate((s) => !s)}
          className="w-5 h-5"
        />
        Simulate movement (desktop / no GPS)
      </label>

      <label className="block border-t border-slate-700 pt-3">
        <div className="flex justify-between text-sm text-slate-300 mb-1">
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
        <div className="text-[10px] text-slate-500 mt-1 leading-tight">
          Blocks high-res imagery older than {maxImageryAge} years.
        </div>
      </label>

      <label className="block border-t border-slate-700 pt-3">
        <div className="flex justify-between text-sm text-slate-300 mb-1">
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
        <div className="text-[10px] text-slate-500 mt-1 leading-tight">
          Lower this if high-res imagery is outdated.
          The map will "overzoom" newer, lower-res tiles instead.
        </div>
      </label>
    </div>
  );

  return (
    <div className="absolute inset-0 z-[1000] bg-slate-900 overflow-y-auto">
      {settingsOpen && (
        <div
          className="fixed inset-0 z-[9]"
          onClick={() => setSettingsOpen(false)}
        />
      )}

      <div className="min-h-full flex items-start justify-center p-4">
        <div className="w-full max-w-md space-y-4 py-6">
          <div>
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-3xl font-extrabold tracking-tight">
                Parku Cīņas
              </h1>
              {/* Settings gear — opens map/debug options. The
                  relative wrapper anchors the dropdown; z-10 keeps
                  the button above the click-outside overlay. */}
              <div className="relative z-10">
                <button
                  onClick={() => setSettingsOpen((o) => !o)}
                  className="w-10 h-10 flex items-center justify-center
                             bg-slate-800/90 backdrop-blur rounded-xl
                             shadow-lg text-slate-200 active:scale-95
                             transition"
                  aria-label="Settings"
                  aria-expanded={settingsOpen}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-5 h-5"
                    aria-hidden="true"
                  >
                    <path d={GEAR_ICON_PATH} />
                  </svg>
                </button>
                {settingsPanel}
              </div>
            </div>
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

            {!position && !simulate && (
              <div className="text-xs text-amber-300">
                Waiting for GPS… on desktop, enable Simulate Movement in
                Settings (gear next to the title).
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
