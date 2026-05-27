import { useState } from 'react';

// Pre-match screen. Lets the player set their name and (when GPS works) a
// bounding side length in meters. The first `player-join` defines the arena
// for everyone in this MVP — multi-arena rooms are out of scope.
export default function AreaPicker({ onJoin, gpsReady, simulate, onToggleSim }) {
  const [name, setName] = useState('');
  const [side, setSide] = useState(120);

  return (
    <div className="absolute inset-0 z-[1000] bg-slate-900/95 backdrop-blur flex items-center justify-center p-6">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-5">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Park Wars</h1>
          <p className="text-slate-400 text-sm mt-1">
            Stand in 5×5 m squares for 5 seconds to claim them. Most squares in 5
            minutes wins.
          </p>
        </div>

        <label className="block">
          <span className="text-sm text-slate-300">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Anonymous"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </label>

        <label className="block">
          <span className="text-sm text-slate-300">
            Arena size (square side, meters)
          </span>
          <input
            type="range"
            min={40}
            max={200}
            step={10}
            value={side}
            onChange={(e) => setSide(parseInt(e.target.value, 10))}
            className="w-full"
          />
          <div className="text-xs text-slate-400">
            {side} m × {side} m ≈ {Math.floor(side / 5) ** 2} cells
          </div>
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={simulate} onChange={onToggleSim} />
          Simulate movement (desktop / no GPS)
        </label>

        {!gpsReady && !simulate && (
          <div className="text-xs text-amber-300">
            Waiting for GPS… on desktop, enable Simulate Movement above.
          </div>
        )}

        <button
          onClick={() => onJoin({ name: name.trim() || undefined, side })}
          disabled={!gpsReady && !simulate}
          className="w-full py-3 rounded-xl bg-cyan-500 disabled:bg-slate-600 text-slate-900 font-bold text-lg shadow active:scale-95 transition"
        >
          Enter the arena
        </button>
      </div>
    </div>
  );
}
