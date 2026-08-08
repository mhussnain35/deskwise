"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Database,
  FileText,
  Layers,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  ThumbsUp,
  Upload,
} from "lucide-react";
import { formatBytes } from "@/lib/format";

interface KBDoc {
  id: string;
  filename: string;
  title: string;
  sizeBytes: number;
  chunkCount: number;
  updatedAt: string;
}

interface Analytics {
  available: boolean;
  message?: string;
  conversations: number;
  questions: number;
  thumbsUp: number;
  thumbsDown: number;
  satisfactionRate: number | null;
  escalations: number;
  recentEscalations: { id: string; question: string; topScore: number | null; createdAt: string }[];
  topQuestions: { question: string; count: number }[];
  userUploads: { documents: number; chunks: number };
}

export default function AdminPage() {
  const [docs, setDocs] = useState<KBDoc[]>([]);
  const [totalDocs, setTotalDocs] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // New Doc Form State
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  /**
   * Admin writes are gated by ADMIN_TOKEN on the server. The token is held in
   * sessionStorage and sent per request — it is never persisted to disk or
   * embedded in the bundle.
   */
  const adminToken = () => {
    let token = sessionStorage.getItem("deskwise_admin_token");
    if (!token) {
      token = window.prompt("Admin token (leave blank if running locally without ADMIN_TOKEN):") || "";
      sessionStorage.setItem("deskwise_admin_token", token);
    }
    return token;
  };

  const adminHeaders = (): Record<string, string> => ({
    "Content-Type": "application/json",
    "x-admin-token": adminToken(),
  });

  const clearAdminToken = () => sessionStorage.removeItem("deskwise_admin_token");

  const loadAdminData = useCallback(async () => {
    const [docsData, analyticsData] = await Promise.all([
      fetch("/api/admin/docs")
        .then((res) => res.json())
        .catch(() => null),
      fetch("/api/admin/analytics")
        .then((res) => res.json())
        .catch(() => null),
    ]);
    return { docsData, analyticsData };
  }, []);

  const applyAdminData = useCallback(
    ({ docsData, analyticsData }: { docsData: unknown; analyticsData: Analytics | null }) => {
      const parsed = docsData as
        | { docs?: KBDoc[]; totalDocs?: number; totalChunks?: number }
        | null;
      if (parsed?.docs) {
        setDocs(parsed.docs);
        setTotalDocs(parsed.totalDocs || 0);
        setTotalChunks(parsed.totalChunks || 0);
      }
      if (analyticsData) setAnalytics(analyticsData);
    },
    []
  );

  /** Explicit refresh — shows the loading state, unlike the initial mount load. */
  const fetchDocs = useCallback(async () => {
    setIsLoading(true);
    try {
      applyAdminData(await loadAdminData());
    } catch (err) {
      console.error("Failed to load admin data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [applyAdminData, loadAdminData]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await loadAdminData();
        if (!cancelled) applyAdminData(data);
      } catch (err) {
        console.error("Failed to load admin data:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyAdminData, loadAdminData]);

  const handleReindex = async () => {
    setIsReindexing(true);
    setStatusMsg("");
    try {
      const res = await fetch("/api/admin/reindex", {
        method: "POST",
        headers: adminHeaders(),
      });
      const data = await res.json();
      if (res.status === 401) clearAdminToken();
      if (res.ok) {
        setStatusMsg(data.message || "Knowledge base re-indexed successfully!");
        void fetchDocs();
      } else {
        setStatusMsg(data.error || "Re-indexing failed.");
      }
    } catch (err) {
      console.error("Reindex error:", err);
      setStatusMsg("Failed to connect to re-index server.");
    } finally {
      setIsReindexing(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    setIsUploading(true);
    setStatusMsg("");

    try {
      const res = await fetch("/api/admin/docs", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ title: newTitle, content: newContent }),
      });

      const data = await res.json();
      if (res.status === 401) clearAdminToken();
      if (res.ok) {
        setStatusMsg(data.message || "Document uploaded & indexed successfully!");
        setNewTitle("");
        setNewContent("");
        setShowUploadModal(false);
        void fetchDocs();
      } else {
        setStatusMsg(data.error || "Upload failed.");
      }
    } catch (err) {
      console.error("Upload error:", err);
      setStatusMsg("Failed to connect to server.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-950 px-4 py-6 font-sans text-slate-100 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between sm:pb-6">
          <div className="flex items-start gap-3 sm:items-center sm:gap-4">
            <Link
              href="/"
              aria-label="Back to chat"
              className="shrink-0 rounded-xl border border-slate-800 bg-slate-900 p-2.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-lg font-bold tracking-tight text-white sm:text-2xl">
                Knowledge Base Admin
                <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-0.5 font-mono text-[10px] uppercase text-indigo-400">
                  v1.1
                </span>
              </h1>
              <p className="mt-1 text-xs text-slate-400">
                Manage support documentation, review usage, and trigger re-indexing.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
            <button
              onClick={handleReindex}
              disabled={isReindexing}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-50"
              title="Re-chunk and re-embed all documents"
            >
              {isReindexing ? (
                <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
              ) : (
                <RefreshCw className="h-4 w-4 text-indigo-400" />
              )}
              <span>{isReindexing ? "Re-indexing…" : "Re-index all"}</span>
            </button>

            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-medium text-white shadow-lg shadow-indigo-600/20 transition-colors hover:bg-indigo-500"
            >
              <Plus className="h-4 w-4" />
              <span>Add doc</span>
            </button>
          </div>
        </div>

        {/* Index metrics */}
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          <MetricCard
            icon={<BookOpen className="h-5 w-5" />}
            tone="indigo"
            label="KB documents"
            value={totalDocs}
          />
          <MetricCard
            icon={<Layers className="h-5 w-5" />}
            tone="purple"
            label="Semantic chunks"
            value={totalChunks}
          />
          <MetricCard
            icon={<Upload className="h-5 w-5" />}
            tone="sky"
            label="User uploads"
            value={analytics?.userUploads?.documents ?? 0}
            hint={`${analytics?.userUploads?.chunks ?? 0} chunks`}
          />
          <MetricCard
            icon={<Database className="h-5 w-5" />}
            tone="emerald"
            label="Vector index"
            value="Active"
            hint="Cosine · 768d · hybrid"
          />
        </div>

        {/* Usage analytics */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3.5 sm:px-6 sm:py-4">
            <h2 className="text-sm font-semibold text-white">Usage analytics</h2>
            <button
              onClick={() => void fetchDocs()}
              className="flex items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden xs:inline">Refresh</span>
            </button>
          </div>

          {!analytics?.available ? (
            <p className="p-6 text-center text-xs text-slate-500">
              {analytics?.message || "Loading analytics…"}
            </p>
          ) : (
            <div className="space-y-5 p-4 sm:p-6">
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatTile
                  icon={<MessageSquare className="h-4 w-4" />}
                  label="Questions asked"
                  value={analytics.questions}
                  sub={`${analytics.conversations} conversation${analytics.conversations === 1 ? "" : "s"}`}
                />
                <StatTile
                  icon={<ThumbsUp className="h-4 w-4" />}
                  label="Satisfaction"
                  value={
                    analytics.satisfactionRate === null
                      ? "—"
                      : `${Math.round(analytics.satisfactionRate * 100)}%`
                  }
                  sub={`${analytics.thumbsUp} up · ${analytics.thumbsDown} down`}
                />
                <StatTile
                  icon={<AlertTriangle className="h-4 w-4" />}
                  label="Escalations"
                  value={analytics.escalations}
                  sub="Low-confidence handoffs"
                />
                <StatTile
                  icon={<Upload className="h-4 w-4" />}
                  label="User documents"
                  value={analytics.userUploads.documents}
                  sub={`${analytics.userUploads.chunks} indexed sections`}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Most asked
                  </h3>
                  {analytics.topQuestions.length === 0 ? (
                    <p className="text-xs text-slate-500">No questions recorded yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {analytics.topQuestions.map((item, index) => (
                        <li key={index} className="flex items-start justify-between gap-3 text-xs">
                          <span className="min-w-0 flex-1 truncate text-slate-300">
                            {item.question}
                          </span>
                          <span className="shrink-0 rounded-full border border-slate-700/60 bg-slate-800/60 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                            ×{item.count}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Recent escalations
                  </h3>
                  {analytics.recentEscalations.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No handoffs yet — every question cleared the confidence threshold.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {analytics.recentEscalations.map((ticket) => (
                        <li
                          key={ticket.id}
                          className="flex items-start justify-between gap-3 text-xs"
                        >
                          <span className="min-w-0 flex-1 truncate text-slate-300">
                            {ticket.question}
                          </span>
                          <span className="shrink-0 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-400">
                            {ticket.topScore !== null
                              ? `${(ticket.topScore * 100).toFixed(0)}%`
                              : "n/a"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Free-tier notes */}
        <div className="grid gap-3 text-xs sm:grid-cols-2 sm:gap-4">
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/15 bg-amber-500/5 p-4 text-amber-300/80">
            <span className="mt-0.5 shrink-0 text-amber-400">⚠️</span>
            <div>
              <p className="mb-0.5 font-semibold text-amber-300">Qdrant Cloud — free tier</p>
              <p className="text-amber-300/60">
                ~1 GB storage · 1 cluster · shared CPU. Comfortable for this KB ({totalChunks}{" "}
                chunks). Upgrade for production traffic.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-sky-500/15 bg-sky-500/5 p-4 text-sky-300/80">
            <span className="mt-0.5 shrink-0 text-sky-400">ℹ️</span>
            <div>
              <p className="mb-0.5 font-semibold text-sky-300">Neon Postgres — free tier</p>
              <p className="text-sky-300/60">
                0.5 GB storage · serverless autosuspend. User uploads store their vectors here and
                are swept after 7 days.
              </p>
            </div>
          </div>
        </div>

        {statusMsg && (
          <div className="flex items-start gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-4 text-xs text-indigo-300">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
            <span>{statusMsg}</span>
          </div>
        )}

        {/* Documents */}
        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3.5 sm:px-6 sm:py-4">
            <h2 className="text-sm font-semibold text-white">Indexed knowledge base</h2>
            <button
              onClick={() => void fetchDocs()}
              className="flex items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden xs:inline">Refresh</span>
            </button>
          </div>

          {isLoading ? (
            <p className="p-10 text-center text-sm text-slate-500">Loading documents…</p>
          ) : docs.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">No documents found in /kb-docs.</p>
          ) : (
            <>
              {/* Cards on phones — a five-column table can't be read at 375px */}
              <ul className="divide-y divide-slate-800/60 sm:hidden">
                {docs.map((doc) => (
                  <li key={doc.id} className="flex items-start gap-3 p-4">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{doc.title}</p>
                      <p className="truncate font-mono text-[11px] text-slate-500">{doc.filename}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 font-mono text-[10px] text-indigo-300">
                          {doc.chunkCount} chunks
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">
                          {formatBytes(doc.sizeBytes)}
                        </span>
                        <span className="flex items-center gap-1 font-mono text-[10px] text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> Indexed
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 bg-slate-950 font-mono text-[10px] uppercase text-slate-400">
                    <tr>
                      <th className="px-6 py-3.5">Document title</th>
                      <th className="px-6 py-3.5">Filename</th>
                      <th className="px-6 py-3.5">Semantic chunks</th>
                      <th className="px-6 py-3.5">File size</th>
                      <th className="px-6 py-3.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {docs.map((doc) => (
                      <tr key={doc.id} className="transition-colors hover:bg-slate-800/30">
                        <td className="px-6 py-4 font-medium text-white">
                          <span className="flex items-center gap-2.5">
                            <FileText className="h-4 w-4 shrink-0 text-indigo-400" />
                            <span className="max-w-xs truncate">{doc.title}</span>
                          </span>
                        </td>
                        <td className="px-6 py-4 font-mono text-slate-400">{doc.filename}</td>
                        <td className="px-6 py-4">
                          <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 font-mono text-[11px] text-indigo-300">
                            {doc.chunkCount} chunks
                          </span>
                        </td>
                        <td className="px-6 py-4 font-mono text-slate-400">
                          {formatBytes(doc.sizeBytes)}
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-[11px] text-emerald-400">
                          Indexed
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Upload modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-slate-800 bg-slate-900 shadow-2xl sm:max-h-[85dvh] sm:max-w-xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <h3 className="text-base font-semibold text-white">Add support document</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={handleUpload}
              className="flex-1 space-y-4 overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              <div>
                <label htmlFor="doc-title" className="mb-1.5 block text-xs font-medium text-slate-300">
                  Document title
                </label>
                <input
                  id="doc-title"
                  type="text"
                  placeholder="e.g. Account Security & 2FA Policy"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-base text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500/60 sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="doc-body" className="mb-1.5 block text-xs font-medium text-slate-300">
                  Markdown content
                </label>
                <textarea
                  id="doc-body"
                  rows={8}
                  placeholder={"# Document Title\n\n## Section Heading\nWrite the support policy details here…"}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-base text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500/60 sm:text-sm"
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Adds to the shared knowledge base everyone is answered from. To ask about a file
                  privately, use the paperclip in the chat instead.
                </p>
              </div>

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="rounded-xl px-4 py-2.5 text-xs text-slate-400 transition-colors hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-medium text-white shadow-md shadow-indigo-600/20 transition-colors hover:bg-indigo-500 disabled:opacity-50"
                >
                  {isUploading ? "Chunking & saving…" : "Upload & index"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const TONES = {
  indigo: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  sky: "bg-sky-500/10 text-sky-400 border-sky-500/20",
} as const;

function MetricCard({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONES;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:gap-4 sm:p-5">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border sm:h-12 sm:w-12 ${TONES[tone]}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-slate-400 sm:text-xs">{label}</p>
        <p className="truncate text-lg font-bold text-white sm:text-2xl">{value}</p>
        {hint && <p className="truncate text-[10px] text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
      <div className="flex items-center gap-2 text-slate-400">
        <span className="text-indigo-400">{icon}</span>
        <span className="truncate text-[11px] font-medium">{label}</span>
      </div>
      <p className="mt-1.5 text-xl font-bold text-white">{value}</p>
      <p className="truncate text-[10px] text-slate-500">{sub}</p>
    </div>
  );
}
