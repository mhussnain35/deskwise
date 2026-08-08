import { Loader2 } from "lucide-react";

/** Route-level loading UI for the admin dashboard. */
export default function AdminLoading() {
  return (
    <div className="min-h-[100dvh] bg-slate-950 px-4 py-6 font-sans text-slate-100 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl space-y-6 sm:space-y-8">
        <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between sm:pb-6">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-slate-900" />
            <div className="space-y-2">
              <div className="h-5 w-48 animate-pulse rounded bg-slate-800/80 sm:w-64" />
              <div className="h-3 w-40 animate-pulse rounded bg-slate-800/60 sm:w-80" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
            <div className="h-10 w-full animate-pulse rounded-xl bg-slate-900 sm:w-32" />
            <div className="h-10 w-full animate-pulse rounded-xl bg-slate-900 sm:w-24" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="h-20 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60 sm:h-24"
            />
          ))}
        </div>

        <div className="h-56 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />

        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 pt-2 text-center"
        >
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-400" />
          <p className="text-xs text-slate-400 sm:text-sm">Loading the knowledge base…</p>
        </div>
      </div>
    </div>
  );
}
