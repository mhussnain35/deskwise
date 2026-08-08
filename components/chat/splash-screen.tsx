"use client";

import React from "react";
import { ShieldCheck } from "lucide-react";
import { DeskwiseMark } from "@/components/brand/deskwise-logo";

/**
 * Branded start-up screen.
 *
 * Held for a fixed minimum (SPLASH_DURATION_MS) rather than only until data
 * arrives — a splash that flashes for 180ms on a warm load and two seconds on a
 * cold one reads as a glitch. A fixed floor makes the entrance the same every
 * time, and the progress bar is tied to that same duration so it always
 * completes exactly as the screen hands over.
 *
 * The chat's own skeleton takes over afterwards if data is *still* loading, so
 * this never becomes the screen a user is stuck staring at.
 */
export const SPLASH_DURATION_MS = 2500;

export function SplashScreen() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Starting Deskwise"
      style={{
        height: "var(--app-height, 100dvh)",
        ["--splash-duration" as string]: `${SPLASH_DURATION_MS}ms`,
      }}
      className="fixed inset-x-0 top-0 z-50 flex w-full flex-col items-center justify-center gap-6 overflow-hidden bg-slate-950 px-6 font-sans text-slate-100"
    >
      {/* Ambient wash behind the mark */}
      <div
        aria-hidden="true"
        className="splash-glow pointer-events-none absolute h-64 w-64 rounded-full bg-indigo-600/25 blur-3xl sm:h-80 sm:w-80"
      />

      <div className="relative flex flex-col items-center gap-5 text-center">
        <div className="splash-rise">
          <DeskwiseMark className="h-20 w-20 drop-shadow-2xl sm:h-24 sm:w-24" />
        </div>

        <div className="splash-rise space-y-2" style={{ animationDelay: "120ms" }}>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Deskwise</h1>
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

      {/* Progress — completes as the splash hands over to the app */}
      <div className="relative mt-2 h-1 w-48 overflow-hidden rounded-full bg-slate-800 sm:w-64">
        <div className="splash-progress h-full w-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
      </div>

      <p className="relative text-xs text-slate-500">Starting up…</p>

      <p className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] text-[11px] text-slate-600">
        Gemini 2.0 Flash · Qdrant · Neon Postgres
      </p>
    </div>
  );
}
