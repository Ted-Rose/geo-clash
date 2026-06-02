// Placeholder — replaced by full implementation in Phase 3.
export default function SnakeGameScreen({ onLeave }) {
  return (
    <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center gap-4 text-center p-6">
      <div className="text-4xl">🐍</div>
      <h2 className="text-xl font-bold">Geo Snake</h2>
      <p className="text-slate-400 text-sm">Game screen coming soon.</p>
      <button
        onClick={onLeave}
        className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-900 font-bold"
      >
        Back to lobby
      </button>
    </div>
  );
}
