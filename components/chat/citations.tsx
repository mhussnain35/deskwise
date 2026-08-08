"use client";

import React, { useState } from "react";
import { ChevronDown, FileText, Upload } from "lucide-react";
import type { Citation } from "./types";

/** Expandable panel showing which sections an answer was grounded in. */
export function CitationsList({ citations }: { citations: Citation[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const uploadedCount = citations.filter((c) => c.scope === "user").length;

  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 text-xs">
      <button
        onClick={() => setIsExpanded((open) => !open)}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-slate-400 transition-colors hover:text-slate-200 active:bg-slate-800/40 rounded-xl"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
          <span className="truncate">
            {citations.length} source{citations.length === 1 ? "" : "s"}
            {uploadedCount > 0 && (
              <span className="text-emerald-400"> · {uploadedCount} from your upload{uploadedCount === 1 ? "" : "s"}</span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-indigo-400">
          <span className="hidden xs:inline">{isExpanded ? "Hide" : "View"}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {isExpanded && (
        <div className="space-y-2.5 border-t border-slate-800/60 p-3">
          {citations.map((citation, index) => (
            <CitationCard key={citation.id || index} citation={citation} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}

function CitationCard({ citation, index }: { citation: Citation; index: number }) {
  const isUpload = citation.scope === "user";

  return (
    <div className="space-y-1.5 rounded-lg border border-slate-800/80 bg-slate-950 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5 font-medium text-slate-300">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-indigo-500/20 font-mono text-[10px] text-indigo-300">
            {index + 1}
          </span>
          <span className="truncate">{citation.title}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isUpload && (
            <span className="flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
              <Upload className="h-2.5 w-2.5" /> Your upload
            </span>
          )}
          {citation.score !== undefined && (
            <span
              className="rounded border border-slate-700/60 bg-slate-800/60 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
              title={
                citation.keywordScore !== undefined
                  ? `Vector similarity ${(citation.score * 100).toFixed(0)}% · keyword ${(citation.keywordScore * 100).toFixed(0)}%`
                  : undefined
              }
            >
              {(citation.score * 100).toFixed(0)}% match
            </span>
          )}
        </div>
      </div>

      {citation.section && (
        <p className="font-mono text-[11px] font-medium text-indigo-300/80">{citation.section}</p>
      )}

      {citation.content && (
        <p className="line-clamp-4 rounded border border-slate-800/40 bg-slate-900/60 p-2 text-[11px] leading-relaxed text-slate-400">
          {citation.content}
        </p>
      )}
    </div>
  );
}
