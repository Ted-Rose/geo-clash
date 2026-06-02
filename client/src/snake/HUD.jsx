// Snake HUD: shows timer, player score/kills, and a mini leaderboard.
export default function SnakeHUD({ remainingSeconds = 0, scores = {}, myId }) {
  const mins = Math.floor(remainingSeconds / 60);
  const secs = Math.floor(remainingSeconds % 60);
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  const sorted = Object.entries(scores)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.score - a.score);

  const me = scores[myId];

  return (
    <div className="pointer-events-none absolute top-3 left-3 right-3 z-[500] flex gap-2 flex-wrap">
      <div className="bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-2 text-center min-w-[80px]">
        <div className="text-xs text-slate-400 uppercase tracking-wide">Time</div>
        <div className="text-xl font-mono font-bold text-cyan-400">{timeStr}</div>
      </div>

      {me && (
        <div className="bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-2 text-center min-w-[80px]">
          <div className="text-xs text-slate-400 uppercase tracking-wide">Score</div>
          <div className="text-xl font-bold text-yellow-300">{me.score}</div>
        </div>
      )}

      <div className="ml-auto bg-slate-900/90 border border-slate-700 rounded-xl px-3 py-2 min-w-[120px]">
        <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Top</div>
        <ul className="space-y-0.5">
          {sorted.slice(0, 4).map((p, i) => (
            <li key={p.id} className="flex justify-between items-center gap-2 text-xs">
              <span className="flex items-center gap-1">
                <span className="text-slate-500 w-3">{i + 1}</span>
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: p.color }}
                />
                <span className={p.id === myId ? 'font-bold text-white' : 'text-slate-300'}>
                  {p.name}
                </span>
              </span>
              <span className="tabular-nums font-bold text-yellow-300">{p.score}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
