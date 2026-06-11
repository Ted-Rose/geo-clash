import { useEffect, useState } from 'react';

function useCountdown(timeLimitMs, matchStartAt) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!timeLimitMs || !matchStartAt) {
      setRemaining(null);
      return;
    }
    function tick() {
      const elapsed = Date.now() - matchStartAt;
      const left = Math.max(0, timeLimitMs - elapsed);
      setRemaining(left);
    }
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [timeLimitMs, matchStartAt]);

  return remaining;
}

function formatTime(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Snake HUD: shows alive counter, player score/kills, and a mini leaderboard.
export default function SnakeHUD({
  players = [],
  scores = {},
  myId,
  timeLimitMs = 0,
  matchStartAt = null,
}) {
  const aliveCount = players.filter((p) => p.alive).length;
  const totalCount = players.length;
  const remaining = useCountdown(timeLimitMs, matchStartAt);

  const sorted = Object.entries(scores)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.score - a.score);

  const me = scores[myId];

  return (
    <div className="pointer-events-none absolute top-3 left-3 right-3 z-[500] flex gap-2 flex-wrap">
      <div className="bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-2 text-center min-w-[80px]">
        <div className="text-xs text-slate-400 uppercase tracking-wide">Alive</div>
        <div className="text-xl font-mono font-bold text-cyan-400">{aliveCount} / {totalCount}</div>
      </div>

      {me && (
        <div className="bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-2 text-center min-w-[80px]">
          <div className="text-xs text-slate-400 uppercase tracking-wide">Score</div>
          <div className="text-xl font-bold text-yellow-300">{me.score}</div>
        </div>
      )}

      {remaining !== null && (
        <div className={`bg-slate-900/90 border rounded-xl px-4 py-2 text-center min-w-[80px] ${
          remaining <= 30000 ? 'border-rose-500' : 'border-slate-700'
        }`}>
          <div className="text-xs text-slate-400 uppercase tracking-wide">Time</div>
          <div className={`text-xl font-mono font-bold ${
            remaining <= 30000 ? 'text-rose-400' : 'text-cyan-400'
          }`}>{formatTime(remaining)}</div>
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
