import { useEffect, useRef, useState } from 'react';

// Bottom action bar:
// - SWING ATTACK: tap, or shake the phone 3x (DeviceMotion) to fire an arrow.
// - SHIELD: tap, or draw a circle gesture on the map area to raise shield.
// - RESPAWN: appears when player has 0 lives; only succeeds if at base cell.
export default function ControlPanel({
  me,
  atBase,
  shieldUntil,
  onAttack,
  onShield,
  onRespawn,
}) {
  const [shieldLeft, setShieldLeft] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setShieldLeft(Math.max(0, ((shieldUntil || 0) - Date.now()) / 1000));
    }, 100);
    return () => clearInterval(t);
  }, [shieldUntil]);

  // Shake detector — needs `DeviceMotionEvent.requestPermission()` on iOS.
  const shakeBufRef = useRef([]);
  const lastFireRef = useRef(0);
  useEffect(() => {
    function onMotion(e) {
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (!a) return;
      const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
      const now = Date.now();
      const buf = shakeBufRef.current;
      if (mag > 22) {
        buf.push(now);
        while (buf.length && now - buf[0] > 1200) buf.shift();
        if (buf.length >= 3 && now - lastFireRef.current > 800) {
          lastFireRef.current = now;
          shakeBufRef.current = [];
          onAttack();
        }
      }
    }
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [onAttack]);

  const enableMotion = async () => {
    try {
      // iOS gatekeeper
      if (typeof DeviceMotionEvent?.requestPermission === 'function') {
        await DeviceMotionEvent.requestPermission();
      }
    } catch {}
  };

  const dead = me && me.lives <= 0;

  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-[500] p-3 flex flex-col gap-3">
      {shieldLeft > 0 && (
        <div className="self-center bg-yellow-300 text-slate-900 font-bold px-3 py-1 rounded-full shadow">
          🛡 Shield {shieldLeft.toFixed(1)}s
        </div>
      )}

      <div className="flex gap-3 justify-center items-end pointer-events-auto">
        <button
          onClick={onShield}
          disabled={dead || shieldLeft > 0}
          className="flex-1 max-w-[160px] h-20 rounded-2xl bg-yellow-400 disabled:bg-slate-600 text-slate-900 font-bold text-lg shadow-lg active:scale-95 transition"
        >
          🛡 SHIELD
        </button>

        {dead ? (
          <button
            onClick={onRespawn}
            disabled={!atBase}
            className={`flex-1 max-w-[200px] h-20 rounded-2xl font-bold text-lg shadow-lg active:scale-95 transition ${
              atBase
                ? 'bg-emerald-400 text-slate-900'
                : 'bg-slate-700 text-slate-400'
            }`}
          >
            {atBase ? '📡 RESPAWN' : 'GO TO BASE'}
          </button>
        ) : (
          <button
            onClick={() => {
              enableMotion();
              onAttack();
            }}
            disabled={dead}
            className="flex-1 max-w-[200px] h-20 rounded-2xl bg-rose-500 disabled:bg-slate-600 text-white font-bold text-lg shadow-lg active:scale-95 transition"
          >
            🏹 SWING ATTACK
          </button>
        )}
      </div>
    </div>
  );
}
