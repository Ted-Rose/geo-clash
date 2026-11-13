import { useEffect, useState } from 'react';

export function useCountdown(timeLimitMs, matchStartAt) {
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

export function formatTime(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Snake HUD: shows alive counter, player score, and the match timer.
// The player list lives in the shared GameMenu burger menu.
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

  const me = scores[myId];

  // Left inset clears the GameMenu burger: left-3 + 48px + gap-3.
  // justify-between spreads the chips edge-to-edge; flex-wrap keeps
  // narrow screens from overflowing.
  return (
    <div
      className="pointer-events-none absolute top-3 left-[72px] right-3
                 z-[500] flex gap-2 flex-wrap justify-between"
    >
      <div
        className="bg-slate-900/90 border border-slate-700 rounded-xl
                   px-4 py-2 text-center min-w-[80px]"
      >
        <div
          className="text-xs text-slate-400 uppercase tracking-wide"
        >
          Alive
        </div>
        <div className="text-xl font-mono font-bold text-cyan-400">
          {aliveCount} / {totalCount}
        </div>
      </div>

      {me && (
        <div
          className="bg-slate-900/90 border border-slate-700 rounded-xl
                     px-4 py-2 text-center min-w-[80px]"
        >
          <div
            className="text-xs text-slate-400 uppercase tracking-wide"
          >
            Score
          </div>
          <div className="text-xl font-bold text-yellow-300">
            {me.score}
          </div>
        </div>
      )}

      {remaining !== null && (
        <div
          className={`bg-slate-900/90 border rounded-xl px-4 py-2
                     text-center min-w-[80px] ${
            remaining <= 30000 ? 'border-rose-500' : 'border-slate-700'
          }`}
        >
          <div
            className="text-xs text-slate-400 uppercase tracking-wide"
          >
            Time
          </div>
          <div
            className={`text-xl font-mono font-bold ${
              remaining <= 30000 ? 'text-rose-400' : 'text-cyan-400'
            }`}
          >
            {formatTime(remaining)}
          </div>
        </div>
      )}
    </div>
  );
}
