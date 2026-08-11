"use client";

import React, { useId } from "react";
import { ShieldCheck } from "lucide-react";
import { DeskwiseMark } from "@/components/brand/deskwise-logo";

/**
 * Branded start-up screen.
 *
 * Held for a fixed minimum (SPLASH_DURATION_MS) rather than only until data
 * arrives — a splash that flashes for 180ms on a warm load and two seconds on a
 * cold one reads as a glitch. A fixed floor makes the entrance the same every
 * time.
 *
 * The loading indicator is deliberately indeterminate, so it makes no claim
 * about how much of that time is left. The chat's own skeleton takes over
 * afterwards if data is *still* loading, so this never becomes the screen a
 * user is stuck staring at.
 */
export const SPLASH_DURATION_MS = 2500;

export function SplashScreen() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Starting Deskwise"
      style={{ height: "var(--app-height, 100dvh)" }}
      className="fixed inset-x-0 top-0 z-50 flex w-full flex-col items-center justify-center gap-6 overflow-hidden bg-slate-950 px-6 font-sans text-slate-100"
    >
      {/* Ambient wash behind the mark */}
      <div
        aria-hidden="true"
        className="splash-glow pointer-events-none absolute h-64 w-64 rounded-full bg-indigo-600/25 blur-3xl sm:h-80 sm:w-80"
      />

      <div className="relative flex flex-col items-center gap-5 text-center">
        <div className="splash-rise">
          <LogoWithProgressRing />
        </div>

        <div className="splash-rise space-y-2" style={{ animationDelay: "120ms" }}>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Deskwise</h1>
          <p className="max-w-xs text-sm text-slate-400 sm:max-w-sm sm:text-base">
            AI support answers, grounded in your documentation
          </p>
        </div>

        <span
          className="splash-fade flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-400"
          style={{ animationDelay: "260ms" }}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Retrieval-grounded
        </span>
      </div>

      <p className="relative text-xs text-slate-500">Initializing your session…</p>

      <p className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] text-[11px] text-slate-600">
        OpenRouter · Qdrant · Neon Postgres
      </p>
    </div>
  );
}

/**
 * The circular mark with a loading arc travelling around it.
 *
 * Indeterminate by design: the arc orbits continuously rather than filling the
 * ring, because a bar that completes makes a promise about *when* — and the
 * work behind this screen (history fetch, possible database wake-up) has no
 * progress to report. A moving arc says "working" without lying about it.
 *
 * Rotation lives on a wrapping element, not on the SVG circle: CSS transforms
 * on SVG children resolve against the user coordinate system, so rotating the
 * circle itself would swing it around the viewBox origin rather than spinning
 * in place.
 */
function LogoWithProgressRing() {
  const gradientId = useId();

  return (
    <div className="relative grid h-[104px] w-[104px] place-items-center sm:h-[120px] sm:w-[120px]">
      <div className="splash-orbit absolute inset-0">
        <svg viewBox="0 0 100 100" aria-hidden="true" className="h-full w-full">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="100" y2="100">
              <stop stopColor="#6366F1" />
              <stop offset="0.55" stopColor="#A855F7" />
              <stop offset="1" stopColor="#EC4899" />
            </linearGradient>
          </defs>

          {/* Track */}
          <circle cx="50" cy="50" r="46" fill="none" stroke="#1E293B" strokeWidth="3.5" />

          {/* Travelling arc */}
          <circle
            className="splash-arc"
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="3.5"
            strokeLinecap="round"
            pathLength="100"
          />
        </svg>
      </div>

      <DeskwiseMark shape="circle" className="h-16 w-16 drop-shadow-2xl sm:h-[72px] sm:w-[72px]" />
    </div>
  );
}
