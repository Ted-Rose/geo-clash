import { useMemo } from 'react';

// Lobby room list: refresh control + one join button per open room.
// Pure presentation — join/refresh wiring is passed in by LobbyScreen.
export default function RoomList({
  rooms, loading, ready, onJoin, onRefresh,
}) {
  const sortedRooms = useMemo(
    () => [...rooms].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [rooms]
  );

  return (
    <div className="bg-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Rooms</h2>
        <button
          onClick={onRefresh}
          className="text-xs text-cyan-400 hover:text-cyan-300
                     active:scale-95 transition"
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
                onClick={() => onJoin(r.id)}
                className="w-full flex items-center justify-between gap-3
                           px-3 py-3 rounded-lg bg-slate-900
                           hover:bg-slate-700 disabled:opacity-50
                           disabled:cursor-not-allowed text-left"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-xs text-slate-400">
                    {r.playerCount}/{r.maxPlayers} · {r.status}
                    {r.gameType === 'snake'
                      && r.foodCountTarget != null && (
                      <>
                        {' · '}
                        {r.arenaSideMeters ?? 50}m · {r.foodCountTarget}
                        {' food · '}
                        {r.foodRespawnIntervalMs / 1000}s
                        {r.timeLimitMs > 0
                          ? ` · ${r.timeLimitMs / 60000}m limit`
                          : ''}
                      </>
                    )}
                  </span>
                </span>
                <span
                  className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                    r.gameType === 'snake'
                      ? 'bg-emerald-800 text-emerald-200'
                      : 'bg-blue-900 text-blue-200'
                  }`}
                >
                  {r.gameType || 'clash'}
                </span>
                <span className="text-cyan-400 font-bold">→</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
