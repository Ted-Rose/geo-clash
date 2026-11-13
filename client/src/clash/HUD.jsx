export default function HUD({
  remainingSeconds,
  me,
  mySquares,
  leaderboard,
  ammo,
  maxAmmo,
}) {
  const mm = Math.floor((remainingSeconds || 0) / 60);
  const ss = Math.floor((remainingSeconds || 0) % 60)
    .toString()
    .padStart(2, '0');
  // pl-[72px] clears the GameMenu burger: left-3 + 48px + gap-3, so the
  // Time chip's gap from the burger matches the Lives chip's 12px gap
  // from the right screen edge.
  const chipClass =
    'bg-slate-900/85 backdrop-blur rounded-xl px-3 py-2 shadow-lg';
  return (
    <div
      className="pointer-events-none absolute top-0 left-0 right-0
                 z-[500] pt-3 pr-3 pb-3 pl-[72px] flex justify-between
                 gap-3"
    >
      <div className={chipClass}>
        <div
          className="text-xs uppercase tracking-wider text-slate-400"
        >
          Time
        </div>
        <div className="text-2xl font-bold tabular-nums">
          {mm}:{ss}
        </div>
      </div>

      <div className={`${chipClass} text-center`}>
        <div
          className="text-xs uppercase tracking-wider text-slate-400"
        >
          Squares
        </div>
        <div
          className="text-2xl font-bold"
          style={{ color: me?.color || '#fff' }}
        >
          {mySquares ?? 0}
        </div>
      </div>

      <div className={chipClass}>
        <div
          className="text-xs uppercase tracking-wider text-slate-400"
        >
          Lives
        </div>
        <div className="text-2xl">
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i}>
              {i < (me?.lives ?? 0) ? '❤️' : '🖤'}
            </span>
          ))}
        </div>
      </div>

      {maxAmmo != null && (
        <div className={chipClass}>
          <div
            className="text-xs uppercase tracking-wider text-slate-400"
          >
            Ammo
          </div>
          <div className="text-2xl flex gap-0.5">
            {Array.from({ length: maxAmmo }).map((_, i) => (
              <span key={i}>
                {i < (ammo ?? maxAmmo) ? '🚀' : '○'}
              </span>
            ))}
          </div>
        </div>
      )}

      {leaderboard?.length > 0 && (
        <div
          className="hidden sm:block bg-slate-900/85 backdrop-blur
                     rounded-xl px-3 py-2 shadow-lg min-w-[160px]"
        >
          <div
            className="text-xs uppercase tracking-wider text-slate-400
                       mb-1"
          >
            Leaders
          </div>
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
