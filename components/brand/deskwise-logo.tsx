import React, { useId } from "react";

/**
 * Deskwise brand mark.
 *
 * A support conversation grounded in a document: a rounded gradient tile
 * carrying a speech bubble whose body is made of document lines. Drawn as
 * inline SVG rather than an image file so it inherits sizing from the layout,
 * stays crisp at every density, and costs no extra request on first paint —
 * which matters when it is the first thing the splash screen shows.
 *
 * Gradient ids are generated per instance with useId; hard-coded ids collide
 * when the mark appears more than once on a page, and every duplicate then
 * renders with whichever definition happened to mount first.
 */
export function DeskwiseMark({ className = "h-10 w-10" }: { className?: string }) {
  const gradientId = useId();

  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="Deskwise"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="0.55" stopColor="#A855F7" />
          <stop offset="1" stopColor="#EC4899" />
        </linearGradient>
      </defs>

      <rect width="48" height="48" rx="12" fill={`url(#${gradientId})`} />

      {/* Speech bubble */}
      <path
        d="M12 15.5C12 13.567 13.567 12 15.5 12h17c1.933 0 3.5 1.567 3.5 3.5v13c0 1.933-1.567 3.5-3.5 3.5H22l-6.2 4.65A1 1 0 0 1 14 35.85V32h1.5c-1.933 0-3.5-1.567-3.5-3.5v-13Z"
        fill="#FFFFFF"
        fillOpacity="0.95"
      />

      {/* Document lines inside the bubble */}
      <rect x="17" y="18" width="14" height="2.6" rx="1.3" fill="#4F46E5" />
      <rect x="17" y="23" width="14" height="2.6" rx="1.3" fill="#7C3AED" fillOpacity="0.75" />
      <rect x="17" y="28" width="8.5" height="2.6" rx="1.3" fill="#DB2777" fillOpacity="0.7" />
    </svg>
  );
}

/** Mark plus the product name, for headers and the splash screen. */
export function DeskwiseWordmark({
  className = "",
  markClassName = "h-9 w-9",
  nameClassName = "text-lg",
}: {
  className?: string;
  markClassName?: string;
  nameClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <DeskwiseMark className={markClassName} />
      <span className={`font-semibold tracking-tight text-white ${nameClassName}`}>Deskwise</span>
    </span>
  );
}
