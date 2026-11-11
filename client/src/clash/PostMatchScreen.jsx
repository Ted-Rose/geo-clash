// Post-match overlay. Shows the room's final ranking + the global top-N
// loaded from /api/leaderboard, then offers a single CTA back to the lobby.
export default function PostMatchScreen({ finalLeaderboard, globalTop, onLeave }) {
  const winner = finalLeaderboard?.[0];
  return (
    <div className="absolute inset-0 z-[1100] flex items-start justify-center bg-slate-900/95 backdrop-blur p-4 overflow-y-auto">
      <div className="w-full max-w-md space-y-4 py-4">
        <div className="text-center space-y-1">
          <div className="text-xs uppercase tracking-widest text-slate-400">
            Match over
          </div>
          {winner && (
            <div className="text-2xl font-extrabold">
              🏆{' '}
              <span style={{ color: winner.color }}>
                {winner.name}
              </span>{' '}
              wins
            </div>
          )}
        </div>

        <section className="bg-slate-800 rounded-2xl p-4 shadow-lg">
          <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-2">
            This match
          </h3>
          <ul className="space-y-1">
            {finalLeaderboard?.map((row, i) => (
              <li
                key={row.id}
                className="flex justify-between items-center px-2 py-1 rounded-md odd:bg-slate-900/50"
              >
                <span className="flex items-center gap-2">
                  <span className="text-slate-500 tabular-nums w-5 text-right">
                    {i + 1}
                  </span>
                  <span
                    className="inline-block w-3 h-3 rounded-sm"
                    style={{ background: row.color }}
                  />
                  <span className="font-semibold">{row.name}</span>
                </span>
                <span className="tabular-nums font-bold">{row.squares}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-slate-800 rounded-2xl p-4 shadow-lg">
          <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-2">
            All-time top
          </h3>
          {globalTop === null && (
            <div className="text-sm text-slate-500">Loading…</div>
          )}
          {Array.isArray(globalTop) && globalTop.length === 0 && (
            <div className="text-sm text-slate-500">No scores archived yet.</div>
          )}
          {Array.isArray(globalTop) && globalTop.length > 0 && (
            <ul className="space-y-1">
              {globalTop.map((row, i) => (
                <li
                  key={row.matchId || `${row.playerId}-${i}`}
                  className="flex justify-between items-center px-2 py-1 rounded-md odd:bg-slate-900/50"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-slate-500 tabular-nums w-5 text-right">
                      {i + 1}
                    </span>
                    {row.color && (
                      <span
                        className="inline-block w-3 h-3 rounded-sm"
                        style={{ background: row.color }}
                      />
                    )}
                    <span className="font-semibold">{row.name || row.playerId}</span>
                  </span>
                  <span className="tabular-nums font-bold">
                    {row.squaresCaptured ?? row.squares ?? 0}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <button
          onClick={onLeave}
          className="w-full py-3 rounded-xl bg-cyan-500 text-slate-900 font-bold shadow active:scale-95 transition"
        >
          Back to lobby
        </button>
      </div>
    </div>
  );
}
