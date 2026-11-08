/**
 * A picture of the product built from plain markup. It is decorative: no Yjs, no canvas, nothing
 * interactive, so it costs the page almost nothing and is hidden from assistive technology.
 */
export function AppPreview() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto mt-14 w-full max-w-5xl rounded-3xl bg-[#f38f86] p-2.5 shadow-2xl sm:p-3.5"
    >
      <div className="overflow-hidden rounded-2xl bg-white text-neutral-900">
      <div className="flex items-center gap-1.5 border-b border-neutral-200 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="ml-3 text-xs text-neutral-400">Payments service design</span>
      </div>

      <div className="grid min-h-[320px] grid-cols-1 md:grid-cols-2">
        {/* Notes pane */}
        <div className="border-b border-neutral-200 p-6 text-left md:border-b-0 md:border-r">
          <p className="text-xl font-bold">Payments service RFC</p>
          <p className="mt-4 text-sm font-semibold">Goals</p>
          <div className="mt-2 space-y-1.5 text-sm text-neutral-600">
            <p className="flex items-center gap-2">
              <span className="flex h-4 w-4 items-center justify-center rounded border border-indigo-600 bg-indigo-600 text-[10px] text-white">
                ✓
              </span>
              Idempotent charge API
            </p>
            <p className="flex items-center gap-2">
              <span className="flex h-4 w-4 items-center justify-center rounded border border-indigo-600 bg-indigo-600 text-[10px] text-white">
                ✓
              </span>
              Retry queue with backoff
            </p>
            <p className="flex items-center gap-2">
              <span className="h-4 w-4 rounded border border-neutral-300" />
              Ledger reconciliation job
            </p>
          </div>
          <p className="mt-5 text-sm font-semibold">Open questions</p>
          <div className="mt-2 space-y-2">
            <div className="h-2 w-11/12 rounded bg-neutral-200" />
            <div className="h-2 w-9/12 rounded bg-neutral-200" />
            <div className="h-2 w-10/12 rounded bg-neutral-200" />
          </div>
        </div>

        {/* Whiteboard pane */}
        <div
          className="relative min-h-[260px] bg-neutral-50"
          style={{
            backgroundImage: 'radial-gradient(circle, rgb(163 163 163 / 0.55) 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        >
          <div className="absolute left-[8%] top-[18%] rounded-md border border-blue-300 bg-blue-100 px-4 py-3 text-xs font-medium text-blue-900">
            Client
          </div>
          <div className="absolute left-[42%] top-[18%] rounded-md border border-violet-300 bg-violet-100 px-4 py-3 text-xs font-medium text-violet-900">
            API
          </div>
          <div className="absolute left-[42%] top-[62%] rounded-md border border-emerald-300 bg-emerald-100 px-4 py-3 text-xs font-medium text-emerald-900">
            Postgres
          </div>
          <svg className="absolute inset-0 h-full w-full" fill="none" aria-hidden="true" focusable="false">
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0 0L8 4L0 8z" className="fill-neutral-500" />
              </marker>
            </defs>
            <line x1="31%" y1="27%" x2="41%" y2="27%" className="stroke-neutral-500" strokeWidth="2" markerEnd="url(#arrow)" />
            <line x1="50%" y1="38%" x2="50%" y2="60%" className="stroke-neutral-500" strokeWidth="2" markerEnd="url(#arrow)" />
          </svg>

          <span className="absolute left-[28%] top-[44%] flex items-center gap-1 rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-medium text-white shadow">
            Maya
          </span>
          <span className="absolute left-[66%] top-[70%] flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-white shadow">
            Jordan
          </span>
        </div>
      </div>
      </div>
    </div>
  );
}
