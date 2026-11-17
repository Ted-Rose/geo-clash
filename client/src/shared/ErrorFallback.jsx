// Full-screen fallback rendered by the Sentry ErrorBoundary when a
// render-time exception escapes the component tree. Mobile-first like
// the rest of the app: portrait layout, ≥44px reload target.
export default function ErrorFallback() {
  return (
    <div
      className="absolute inset-0 z-[2000] bg-slate-900 flex items-center
                 justify-center p-4"
      role="alert"
    >
      <div className="w-full max-w-md text-center space-y-4">
        <h1 className="text-2xl font-extrabold tracking-tight
                       text-slate-100">
          Something went wrong
        </h1>
        <p className="text-sm text-slate-400">
          The app hit an unexpected error. It has been reported — reload
          to get back into the arena.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="min-h-[44px] min-w-[44px] w-full sm:w-auto px-6 py-3
                     rounded-xl bg-cyan-500 text-slate-900 font-semibold
                     active:scale-95 transition"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
