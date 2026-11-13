import { useState } from "react";

// Shared in-game burger menu — identical chrome for every mini game.
// Renders Leave + a player list sorted by score. `children` is the
// per-game extension slot for extra items between Leave and Players
// (e.g. clash's "Lock map view" toggle).
// players: [{ id, name, color, score?, alive? }]
export default function GameMenu({ onLeave, players = [], myId, children }) {
  const [open, setOpen] = useState(false);

  const sorted = [...players].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0),
  );

  return (
    <>
      {/* Click-outside overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[600]"
          onClick={() => setOpen(false)}
          data-testid="menu-overlay"
        />
      )}

      <div className="absolute top-3 left-3 z-[601]">
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-12 h-12 flex items-center justify-center
                     bg-slate-900/85 backdrop-blur rounded-xl shadow-lg
                     text-slate-200 active:scale-95 transition"
          aria-label="Menu"
          aria-expanded={open}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="w-6 h-6"
            aria-hidden="true"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        {open && (
          <div
            className="mt-2 bg-slate-900/95 backdrop-blur rounded-xl
                       shadow-xl p-2 flex flex-col gap-1 min-w-[200px]
                       max-h-[70vh] overflow-y-auto"
          >
            <button
              onClick={() => {
                setOpen(false);
                onLeave();
              }}
              className="w-full text-left px-3 py-2 rounded-lg
                         text-slate-200 hover:bg-slate-700
                         active:scale-95 transition text-base"
            >
              ⤺ Leave
            </button>
            {children}
            {sorted.length > 0 && (
              <>
                <div className="border-t border-slate-700 my-1" />
                <div
                  className="px-3 py-1 text-xs uppercase tracking-wider
                             text-slate-500"
                >
                  Players
                </div>
                {sorted.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 px-3 py-1.5
                               text-base text-slate-200
                               ${p.alive === false ? "opacity-50" : ""}`}
                  >
                    <span
                      className="inline-block w-3 h-3 rounded-full
                                 flex-shrink-0"
                      style={{ background: p.color || "#94a3b8" }}
                    />
                    <span
                      className={`truncate ${
                        p.id === myId ? "font-semibold" : ""
                      }`}
                    >
                      {p.name}
                    </span>
                    {p.id === myId && (
                      <span className="text-xs text-slate-400">
                        (you)
                      </span>
                    )}
                    <span className="ml-auto tabular-nums">
                      {p.score ?? ""}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
