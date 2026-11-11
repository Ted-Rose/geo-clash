import { useState } from 'react';

// Lobby create-room form: game-type picker + per-game option fields +
// "Create + join" submit. Owns its field state and hands the assembled
// room-create payload (sans center coords) to onCreate.
export default function RoomCreateForm({ ready, onCreate }) {
  const [newRoomName, setNewRoomName] = useState('');
  const [cellSize, setCellSize] = useState(5);
  const [squaresPerSide, setSquaresPerSide] = useState(10);
  const [ammoLimit, setAmmoLimit] = useState(0);
  const [ammoRenewalSec, setAmmoRenewalSec] = useState(5);
  const [createGameType, setCreateGameType] = useState('clash');
  const [foodCount, setFoodCount] = useState(30);
  const [foodRespawnSec, setFoodRespawnSec] = useState(1);
  const [arenaSideMeters, setArenaSideMeters] = useState(50);
  const [timeLimitSec, setTimeLimitSec] = useState(0);

  function handleCreate() {
    onCreate({
      name: newRoomName.trim() || undefined,
      cellSize,
      squaresPerSide,
      gameType: createGameType,
      ...(createGameType === 'clash' && ammoLimit > 0 && {
        maxAmmo: ammoLimit,
        ammoRenewalMs: ammoRenewalSec * 1000,
      }),
      ...(createGameType === 'snake' && {
        foodCountTarget: foodCount,
        foodRespawnIntervalMs: foodRespawnSec * 1000,
        arenaSideMeters,
        timeLimitMs: timeLimitSec > 0 ? timeLimitSec * 1000 : 0,
      }),
    });
  }

  return (
    <div className="bg-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
      <h2 className="text-lg font-bold">Create new room</h2>
      <div className="flex gap-2">
        {['clash', 'snake'].map((gt) => (
          <button
            key={gt}
            onClick={() => setCreateGameType(gt)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold
                       capitalize transition ${
              createGameType === gt
                ? 'bg-cyan-500 text-slate-900'
                : 'bg-slate-700 text-slate-300'
            }`}
          >
            {gt === 'clash' ? 'Geo Clash' : 'Geo Snake'}
          </button>
        ))}
      </div>
      <input
        value={newRoomName}
        onChange={(e) => setNewRoomName(e.target.value)}
        placeholder="Room name (optional)"
        className="w-full px-3 py-3 rounded-lg bg-slate-900 border
                   border-slate-700 focus:outline-none focus:ring-2
                   focus:ring-cyan-500 text-base"
      />
      {createGameType === 'clash' && (
        <>
          <label className="block">
            <div className="flex justify-between text-sm text-slate-300 mb-1">
              <span>Square size</span>
              <span className="font-mono text-cyan-400">
                {cellSize}×{cellSize} m
              </span>
            </div>
            <input
              type="range"
              min={5}
              max={30}
              step={5}
              value={cellSize}
              onChange={(e) => setCellSize(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
            <div
              className="flex justify-between text-xs text-slate-500 mt-0.5"
            >
              <span>5 m</span>
              <span>30 m</span>
            </div>
          </label>
          <label className="block">
            <div className="flex justify-between text-sm text-slate-300 mb-1">
              <span>Square count</span>
              <span className="font-mono text-cyan-400">
                {squaresPerSide}×{squaresPerSide} ={' '}
                {squaresPerSide * squaresPerSide} squares
              </span>
            </div>
            <input
              type="range"
              min={5}
              max={20}
              step={1}
              value={squaresPerSide}
              onChange={(e) => setSquaresPerSide(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
            <div
              className="flex justify-between text-xs text-slate-500 mt-0.5"
            >
              <span>5×5</span>
              <span>20×20</span>
            </div>
          </label>
          <label className="block border-t border-slate-700 pt-3">
            <div className="text-sm text-slate-300 mb-2">
              Rocket ammo limit
            </div>
            <div className="flex gap-2">
              {[0, 3, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmmoLimit(v)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold
                             transition ${
                    ammoLimit === v
                      ? 'bg-cyan-500 text-slate-900'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {v === 0 ? '∞ Unlimited' : `${v} rockets`}
                </button>
              ))}
            </div>
            {ammoLimit > 0 && (
              <label className="block mt-3">
                <div
                  className="flex justify-between text-sm text-slate-300
                             mb-1"
                >
                  <span>Renewal time</span>
                  <span className="font-mono text-cyan-400">
                    {ammoRenewalSec} s
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={30}
                  step={1}
                  value={ammoRenewalSec}
                  onChange={(e) =>
                    setAmmoRenewalSec(Number(e.target.value))
                  }
                  className="w-full accent-cyan-500"
                />
                <div
                  className="flex justify-between text-xs text-slate-500
                             mt-0.5"
                >
                  <span>1 s</span>
                  <span>30 s</span>
                </div>
              </label>
            )}
          </label>
        </>
      )}
      {createGameType === 'snake' && (
        <>
          <label className="block">
            <div className="flex justify-between text-sm text-slate-300 mb-1">
              <span>Arena size</span>
              <span className="font-mono text-cyan-400">
                {arenaSideMeters} × {arenaSideMeters} m
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={1000}
              step={50}
              value={arenaSideMeters}
              onChange={(e) => setArenaSideMeters(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
            <div
              className="flex justify-between text-xs text-slate-500 mt-0.5"
            >
              <span>50 m</span>
              <span>1000 m</span>
            </div>
          </label>
          <label className="block">
            <div className="flex justify-between text-sm text-slate-300 mb-1">
              <span>Food pellets</span>
              <span className="font-mono text-cyan-400">{foodCount}</span>
            </div>
            <input
              type="range"
              min={3}
              max={100}
              step={1}
              value={foodCount}
              onChange={(e) => setFoodCount(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
            <div
              className="flex justify-between text-xs text-slate-500 mt-0.5"
            >
              <span>3</span>
              <span>30</span>
            </div>
          </label>
          <label className="block border-t border-slate-700 pt-3">
            <div className="flex justify-between text-sm text-slate-300 mb-1">
              <span>Time limit</span>
              <span className="font-mono text-cyan-400">
                {timeLimitSec === 0
                  ? '∞ No limit'
                  : `${timeLimitSec / 60} min`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={30}
              step={1}
              value={timeLimitSec / 60}
              onChange={(e) =>
                setTimeLimitSec(Number(e.target.value) * 60)
              }
              className="w-full accent-cyan-500"
            />
            <div
              className="flex justify-between text-xs text-slate-500 mt-0.5"
            >
              <span>∞</span>
              <span>30 min</span>
            </div>
          </label>
          <label className="block">
            <div className="flex justify-between text-sm text-slate-300 mb-1">
              <span>Respawn every</span>
              <span className="font-mono text-cyan-400">
                {foodRespawnSec} s
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={foodRespawnSec}
              onChange={(e) => setFoodRespawnSec(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
            <div
              className="flex justify-between text-xs text-slate-500 mt-0.5"
            >
              <span>1 s</span>
              <span>20 s</span>
            </div>
          </label>
        </>
      )}
      <button
        onClick={handleCreate}
        disabled={!ready}
        className="w-full py-3 rounded-xl bg-cyan-500 disabled:bg-slate-600
                   disabled:cursor-not-allowed text-slate-900 font-bold
                   text-lg shadow active:scale-95 transition"
      >
        Create + join
      </button>
    </div>
  );
}
