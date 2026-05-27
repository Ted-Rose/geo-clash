export default function HUD({ remainingSeconds, me, mySquares, leaderboard }) {
  const mm = Math.floor((remainingSeconds || 0) / 60);
  const ss = Math.floor((remainingSeconds || 0) % 60).toString().padStart(2, '0');
  return (
    <div className="pointer-events-none absolute top-0 left-0 right-0 z-[500] p-3 flex justify-between gap-3">
      <div className="bg-slate-900/85 backdrop-blur rounded-xl px-3 py-2 shadow-lg">
        <div className="text-xs uppercase tracking-wider text-slate-400">Time</div>
        <div className="text-2xl font-bold tabular-nums">
          {mm}:{ss}
        </div>
      </div>

      <div className="bg-slate-900/85 backdrop-blur rounded-xl px-3 py-2 shadow-lg text-center">
        <div className="text-xs uppercase tracking-wider text-slate-400">Squares</div>
        <div className="text-2xl font-bold" style={{ color: me?.color || '#fff' }}>
          {mySquares ?? 0}
        </div>
      </div>

      <div className="bg-slate-900/85 backdrop-blur rounded-xl px-3 py-2 shadow-lg">
        <div className="text-xs uppercase tracking-wider text-slate-400">Lives</div>
        <div className="text-2xl">
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i}>{i < (me?.lives ?? 0) ? '❤️' : '🖤'}</span>
          ))}
        </div>
      </div>

      {leaderboard?.length > 0 && (
        <div className="hidden sm:block bg-slate-900/85 backdrop-blur rounded-xl px-3 py-2 shadow-lg min-w-[160px]">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">Leaders</div>
          <ul className="text-sm space-y-0.5">
            {leaderboard.slice(0, 4).map((row) => (
              <li key={row.id} className="flex justify-between">
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block w-3 h-3 rounded-sm"
                    style={{ background: row.color }}
                  />
                  {row.name}
                </span>
                <span className="tabular-nums">{row.squares}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
