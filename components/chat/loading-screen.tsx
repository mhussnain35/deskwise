"use client";

import React, { useEffect, useState } from "react";
import { Bot, Loader2 } from "lucide-react";

/**
 * Loading state for the chat.
 *
 * Built as a skeleton of the interface it is about to become — header, a couple
 * of message rows, composer — rather than a bare spinner on an empty page, so
 * the layout doesn't jump when the real content arrives and the wait reads as
 * "this is loading" instead of "this is broken".
 *
 * The copy escalates rather than sitting on one line forever: the free-tier
 * Postgres autosuspends, and the first request after idle can take a few
 * seconds. Saying so after four seconds is the difference between a slow app
 * and an app the user assumes has hung.
 */

const SLOW_AFTER_MS = 4000;
const STILL_SLOW_AFTER_MS = 10000;

const SHELL_STYLE: React.CSSProperties = {
  height: "var(--app-height, 100dvh)",
  transform: "translateY(var(--viewport-offset, 0px))",
};

export function ChatLoadingScreen() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const slow = window.setTimeout(() => setElapsed(SLOW_AFTER_MS), SLOW_AFTER_MS);
    const stillSlow = window.setTimeout(
      () => setElapsed(STILL_SLOW_AFTER_MS),
      STILL_SLOW_AFTER_MS
    );
    return () => {
      window.clearTimeout(slow);
      window.clearTimeout(stillSlow);
    };
  }, []);

  const message =
    elapsed >= STILL_SLOW_AFTER_MS
      ? "Still working — this can take a few seconds on the first request."
      : elapsed >= SLOW_AFTER_MS
        ? "Waking up the database…"
        : "Loading your conversation…";

  return (
    <div
      style={SHELL_STYLE}
      className="fixed inset-x-0 top-0 mx-auto flex w-full max-w-5xl flex-col overflow-hidden bg-slate-950 font-sans text-slate-100 sm:border-x sm:border-slate-800/60"
    >
      {/* Header skeleton */}
      <header className="flex items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-900/70 px-3 py-2.5 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 sm:h-10 sm:w-10">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div className="space-y-1.5">
            <Shimmer className="h-3.5 w-24 sm:w-28" />
            <Shimmer className="h-2.5 w-32 sm:w-40" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Shimmer className="h-8 w-9 rounded-lg sm:w-24" />
          <Shimmer className="h-8 w-9 rounded-lg sm:w-20" />
        </div>
      </header>

      {/* Message skeletons */}
      <div className="min-h-0 flex-1 space-y-5 overflow-hidden px-3 py-5 sm:space-y-6 sm:px-6 sm:py-6">
        <MessageSkeleton />
        <MessageSkeleton align="right" lines={1} />
        <MessageSkeleton lines={2} />
      </div>

      {/* Status — the only element that carries real information */}
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-center gap-2 px-4 pb-2 text-center"
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-400" />
        <p className="text-xs text-slate-400 sm:text-sm">{message}</p>
      </div>

      {/* Composer skeleton */}
      <footer className="shrink-0 border-t border-slate-800/80 bg-slate-900/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-5 sm:pt-4">
        <div className="flex items-center gap-2">
          <Shimmer className="h-12 flex-1 rounded-3xl" />
          <Shimmer className="h-11 w-11 shrink-0 rounded-full" />
        </div>
      </footer>
    </div>
  );
}

function MessageSkeleton({
  align = "left",
  lines = 3,
}: {
  align?: "left" | "right";
  lines?: number;
}) {
  const widths = ["w-[85%]", "w-[70%]", "w-[45%]"];

  return (
    <div className={`flex items-start gap-2.5 sm:gap-3.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
      <Shimmer className="h-8 w-8 shrink-0 rounded-lg" />
      <div
        className={`flex min-w-0 max-w-[calc(100%-3rem)] flex-1 flex-col gap-2 sm:max-w-[78%] ${
          align === "right" ? "items-end" : "items-start"
        }`}
      >
        <div
          className={`w-full space-y-2 rounded-2xl border border-slate-800/60 bg-slate-900/60 p-3.5 ${
            align === "right" ? "rounded-tr-sm" : "rounded-tl-sm"
          }`}
        >
          {Array.from({ length: lines }, (_, index) => (
            <Shimmer key={index} className={`h-3 ${widths[index % widths.length]}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Neutral placeholder block. Animation is dropped under reduced-motion. */
function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-800/80 ${className}`} aria-hidden="true" />;
}
