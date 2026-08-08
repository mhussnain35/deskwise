"use client";

import { useEffect } from "react";

/**
 * Keeps the composer above the on-screen keyboard.
 *
 * On a phone, opening the keyboard shrinks the *visual* viewport but leaves the
 * layout viewport — and therefore `100dvh` — unchanged. A chat shell sized in
 * dvh keeps its full height, so the composer at the bottom of that column ends
 * up underneath the keyboard, which is exactly where you can't see what you're
 * typing.
 *
 * VisualViewport reports the real numbers. Two custom properties are published
 * on <html> and consumed by the chat shell and the documents sheet:
 *
 *   --app-height       height of the area actually on screen
 *   --viewport-offset  how far the browser scrolled the layout viewport up,
 *                      which the shell cancels out with a transform
 *
 * They are only set **while the keyboard is open**, and removed otherwise. The
 * default path therefore stays on plain `100dvh`, which the browser keeps
 * correct on its own through rotation, toolbar collapse and window resizing —
 * a written-once pixel value gets those wrong the moment it goes stale.
 */

/** Viewport shrinkage below this is a browser toolbar, not a keyboard. */
const KEYBOARD_THRESHOLD_PX = 120;

export function useVisualViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return; // no support → 100dvh fallback, unchanged behaviour

    const root = document.documentElement;

    const clear = () => {
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--viewport-offset");
    };

    const apply = () => {
      const occluded = window.innerHeight - viewport.height - viewport.offsetTop;

      if (occluded > KEYBOARD_THRESHOLD_PX) {
        root.style.setProperty("--app-height", `${Math.round(viewport.height)}px`);
        root.style.setProperty("--viewport-offset", `${Math.round(viewport.offsetTop)}px`);
      } else {
        clear();
      }
    };

    apply();

    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    window.addEventListener("orientationchange", apply);
    // Restoring from the back/forward cache replays no resize event, so a stale
    // keyboard offset would survive the navigation without this.
    window.addEventListener("pageshow", apply);

    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      window.removeEventListener("orientationchange", apply);
      window.removeEventListener("pageshow", apply);
      clear();
    };
  }, []);
}
