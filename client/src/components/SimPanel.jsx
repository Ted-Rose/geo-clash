import { useEffect, useState } from 'react';

// Debug panel for localhost / desktop testing.
// - WASD or arrow keys nudge a fake GPS position.
// - "Add bot" spawns a roaming AI through a second socket connection.
export default function SimPanel({ simPos, setSimPos, onSpawnBot, botCount, onAttackAtTarget, hasTarget }) {
  const [step, setStep] = useState(0.00005); // ~5.5m at the equator

  useEffect(() => {
    function onKey(e) {
      if (!simPos) return;
      let dLat = 0,
        dLng = 0;
      if (e.key === 'ArrowUp' || e.key === 'w') dLat = step;
      else if (e.key === 'ArrowDown' || e.key === 's') dLat = -step;
      else if (e.key === 'ArrowLeft' || e.key === 'a') dLng = -step;
      else if (e.key === 'ArrowRight' || e.key === 'd') dLng = step;
      else return;
      e.preventDefault();
      const heading =
        dLat > 0 ? 0 : dLat < 0 ? 180 : dLng > 0 ? 90 : 270;
      setSimPos({
        lat: simPos.lat + dLat,
        lng: simPos.lng + dLng,
        heading,
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [simPos, step, setSimPos]);

  return (
    <div className="pointer-events-auto absolute left-3 bottom-28 z-[600] bg-slate-900/90 border border-slate-700 rounded-xl p-3 text-xs space-y-2 max-w-[220px]">
      <div className="font-bold text-slate-200">Simulate Movement</div>
      <div className="text-slate-400">
        WASD / arrows to walk. Step ≈ {(step * 111000).toFixed(1)} m.
      </div>
      <input
        type="range"
        min={0.00001}
        max={0.0002}
        step={0.00001}
        value={step}
        onChange={(e) => setStep(parseFloat(e.target.value))}
        className="w-full"
      />
      <div className="flex gap-2">
        <button
          onClick={onSpawnBot}
          className="flex-1 bg-cyan-500 text-slate-900 font-semibold rounded px-2 py-1"
        >
          + Bot ({botCount})
        </button>
      </div>
      {onAttackAtTarget && (
        <button
          onClick={onAttackAtTarget}
          disabled={!hasTarget}
          className="w-full bg-rose-500 disabled:bg-slate-700 text-white font-semibold rounded px-2 py-1"
        >
          🏹 Attack at target {hasTarget ? '' : '(long-press map)'}
        </button>
      )}
      {simPos && (
        <div className="text-slate-500 tabular-nums">
          {simPos.lat.toFixed(6)}, {simPos.lng.toFixed(6)}
        </div>
      )}
    </div>
  );
}
