"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, Layers, Database, RefreshCw, CheckCircle2, FileText, Plus, Sparkles, Loader2 } from "lucide-react";

interface KBDoc {
  id: string;
  filename: string;
  title: string;
  sizeBytes: number;
  chunkCount: number;
  updatedAt: string;
}

export default function AdminPage() {
  const [docs, setDocs] = useState<KBDoc[]>([]);
  const [totalDocs, setTotalDocs] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // New Doc Form State
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    fetchDocs();
  }, []);

  const fetchDocs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/docs");
      const data = await res.json();
      if (data.docs) {
        setDocs(data.docs);
        setTotalDocs(data.totalDocs || 0);
        setTotalChunks(data.totalChunks || 0);
      }
    } catch (err) {
      console.error("Failed to load admin docs:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReindex = async () => {
    setIsReindexing(true);
    setStatusMsg("");
    try {
      const res = await fetch("/api/admin/reindex", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setStatusMsg(data.message || "Knowledge base re-indexed successfully!");
        fetchDocs();
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          content: newContent,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setStatusMsg(data.message || "Document uploaded & indexed successfully!");
        setNewTitle("");
        setNewContent("");
        setShowUploadModal(false);
        fetchDocs();
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
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6 sm:p-10">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                Knowledge Base Admin
                <span className="text-xs uppercase px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
                  v1.0
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Manage SaaS support documentation, view semantic vector chunking metrics, and trigger dynamic re-indexing.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleReindex}
              disabled={isReindexing}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 font-medium text-xs transition-colors disabled:opacity-50"
              title="Re-chunk and re-embed all documents"
            >
              {isReindexing ? (
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              ) : (
                <RefreshCw className="w-4 h-4 text-indigo-400" />
              )}
              <span>{isReindexing ? "Re-indexing..." : "Re-index All Docs"}</span>
            </button>

            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-lg shadow-indigo-600/20 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Add Knowledge Doc</span>
            </button>
          </div>
        </div>

        {/* Metrics Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">KB Documents</p>
              <p className="text-2xl font-bold text-white">{totalDocs}</p>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Semantic Chunks</p>
              <p className="text-2xl font-bold text-white">{totalChunks}</p>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Vector Index Status</p>
              <p className="text-sm font-semibold text-emerald-400 flex items-center gap-1.5 mt-1">
                <CheckCircle2 className="w-4 h-4" /> Active (Cosine 768d)
              </p>
            </div>
          </div>
        </div>

        {statusMsg && (
          <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {/* Document Table */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Indexed Knowledge Base Documents</h2>
            <button
              onClick={fetchDocs}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Table</span>
            </button>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-slate-500 text-sm">Loading documents...</div>
          ) : docs.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm">No documents found in /kb-docs.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase font-mono text-[10px]">
                  <tr>
                    <th className="px-6 py-3.5">Document Title</th>
                    <th className="px-6 py-3.5">Filename</th>
                    <th className="px-6 py-3.5">Semantic Chunks</th>
                    <th className="px-6 py-3.5">File Size</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {docs.map((doc) => (
                    <tr key={doc.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 font-medium text-white flex items-center gap-2.5">
                        <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                        <span className="truncate max-w-xs">{doc.title}</span>
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-400">{doc.filename}</td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-mono text-[11px]">
                          {doc.chunkCount} chunks
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-400">
                        {(doc.sizeBytes / 1024).toFixed(1)} KB
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-[11px] text-emerald-400 font-mono">Indexed</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Upload Document Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="text-base font-semibold text-white">Add New Support Document</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Document Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. Account Security & 2FA Policy"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500/60"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Document Markdown Content
                </label>
                <textarea
                  rows={8}
                  placeholder="# Document Title&#10;&#10;## Section Heading&#10;Write the support policy details here..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm font-mono text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500/60"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/20 disabled:opacity-50"
                >
                  {isUploading ? "Chunking & Saving..." : "Upload & Index Document"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
