"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { formatBytes, formatRelativeTime } from "@/lib/format";
import type { DocumentsState } from "./use-documents";

export const UPLOAD_ACCEPT =
  ".pdf,.docx,.md,.markdown,.txt,.csv,.json,application/pdf,text/markdown,text/plain,text/csv,application/json";

interface DocumentPanelProps {
  open: boolean;
  onClose: () => void;
  state: DocumentsState;
}

/**
 * Manager for the documents attached to this conversation.
 *
 * Renders as a bottom sheet on phones (thumb-reachable, dismissed by dragging
 * the handle or tapping the backdrop) and as a right-hand drawer from the small
 * breakpoint up.
 */
export function DocumentPanel({ open, onClose, state }: DocumentPanelProps) {
  const { documents, limits, isLoading, uploadingName, error, notice, upload, remove } = state;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const atCapacity = documents.length >= limits.maxDocs;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleFiles = (files: FileList | null) => {
    if (files && files.length > 0) void upload(files);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex sm:justify-end">
      <button
        aria-label="Close documents panel"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
      />

      <aside
        role="dialog"
        aria-label="Your documents"
        className="relative mt-auto flex max-h-[85dvh] w-full flex-col rounded-t-2xl border border-slate-800 bg-slate-900 shadow-2xl sm:mt-0 sm:h-full sm:max-h-none sm:w-[26rem] sm:rounded-none sm:border-y-0 sm:border-r-0"
      >
        {/* Drag handle — mobile affordance only */}
        <div className="flex justify-center pt-2 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-slate-700" />
        </div>

        <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5 sm:py-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Your documents</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Ask questions about files you upload. Only this chat can see them.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {/* Dropzone */}
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              if (!atCapacity) handleFiles(event.dataTransfer.files);
            }}
            className={`rounded-xl border border-dashed p-4 text-center transition-colors ${
              isDragging
                ? "border-indigo-400 bg-indigo-500/10"
                : "border-slate-700 bg-slate-950/60"
            } ${atCapacity ? "opacity-60" : ""}`}
          >
            <UploadCloud className="mx-auto mb-2 h-6 w-6 text-indigo-400" />
            <p className="text-xs text-slate-300">
              {atCapacity
                ? `You've reached the ${limits.maxDocs}-document limit.`
                : "Drop a file here, or"}
            </p>

            {!atCapacity && (
              <button
                onClick={() => inputRef.current?.click()}
                disabled={Boolean(uploadingName)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
              >
                {uploadingName ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing…
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-3.5 w-3.5" /> Choose a file
                  </>
                )}
              </button>
            )}

            <p className="mt-2 text-[11px] text-slate-500">
              PDF, DOCX, Markdown, TXT, CSV or JSON · up to {limits.maxFileMb} MB ·{" "}
              {documents.length}/{limits.maxDocs} used
            </p>

            <input
              ref={inputRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              className="hidden"
              onChange={(event) => handleFiles(event.target.files)}
            />
          </div>

          {uploadingName && (
            <p className="flex items-center gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span className="truncate">
                Reading and indexing &ldquo;{uploadingName}&rdquo;…
              </span>
            </p>
          )}

          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          {notice && !error && (
            <p className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{notice}</span>
            </p>
          )}

          {/* Document list */}
          {isLoading ? (
            <p className="py-6 text-center text-xs text-slate-500">Loading your documents…</p>
          ) : documents.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              No documents yet. Upload one and ask a question about it.
            </p>
          ) : (
            <ul className="space-y-2">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-500/20 bg-indigo-500/10">
                    <FileText className="h-4 w-4 text-indigo-400" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-white">{doc.title}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      {doc.fileType ? `${doc.fileType.toUpperCase()} · ` : ""}
                      {formatBytes(doc.sizeBytes)} · {doc.chunkCount} section
                      {doc.chunkCount === 1 ? "" : "s"} · {formatRelativeTime(doc.uploadedAt)}
                    </p>
                  </div>

                  <button
                    onClick={() => void remove(doc.id)}
                    aria-label={`Remove ${doc.title}`}
                    className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-slate-800 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[11px] text-slate-500 sm:px-5">
          Uploads are private to this chat session and removed automatically after{" "}
          {limits.retentionDays} days.
        </footer>
      </aside>
    </div>
  );
}
