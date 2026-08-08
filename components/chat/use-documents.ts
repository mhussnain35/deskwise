"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UploadLimits, UserDocument } from "./types";

const DEFAULT_LIMITS: UploadLimits = { maxDocs: 5, maxFileMb: 8, retentionDays: 7 };

export interface DocumentsState {
  documents: UserDocument[];
  limits: UploadLimits;
  isLoading: boolean;
  /** Name of the file currently being processed, if any. */
  uploadingName: string | null;
  error: string | null;
  notice: string | null;
  upload: (files: File[] | FileList) => Promise<void>;
  importUrl: (url: string) => Promise<boolean>;
  remove: (docId: string) => Promise<void>;
  clearMessages: () => void;
}

/** Loads, uploads and deletes the documents attached to one chat session. */
export function useDocuments(sessionId: string): DocumentsState {
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [limits, setLimits] = useState<UploadLimits>(DEFAULT_LIMITS);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Guards against a response from a previous session landing after a reset.
  const activeSession = useRef(sessionId);
  useEffect(() => {
    activeSession.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/documents?sessionId=${encodeURIComponent(sessionId)}`);
        const data = await res.json();
        if (cancelled || activeSession.current !== sessionId) return;
        if (Array.isArray(data?.documents)) setDocuments(data.documents);
        if (data?.limits) setLimits(data.limits);
      } catch (err) {
        console.warn("Could not load uploaded documents:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const upload = useCallback(
    async (files: File[] | FileList) => {
      const queue = Array.from(files);
      if (queue.length === 0 || !sessionId) return;

      setError(null);
      setNotice(null);

      for (const file of queue) {
        setUploadingName(file.name);

        try {
          const form = new FormData();
          form.append("sessionId", sessionId);
          form.append("file", file);

          const res = await fetch("/api/documents", { method: "POST", body: form });
          const data = await res.json().catch(() => ({}));

          if (!res.ok) {
            setError(data.error || `"${file.name}" could not be uploaded.`);
            continue;
          }

          if (activeSession.current !== sessionId) return;
          setDocuments((prev) => [data.document, ...prev]);
          setNotice(data.message || `"${file.name}" is ready to query.`);
        } catch (err) {
          console.error("Upload failed:", err);
          setError(`"${file.name}" could not be uploaded. Check your connection and try again.`);
        }
      }

      setUploadingName(null);
    },
    [sessionId]
  );

  /** Import a document from a link. Resolves true when it was added. */
  const importUrl = useCallback(
    async (url: string): Promise<boolean> => {
      const trimmed = url.trim();
      if (!trimmed || !sessionId) return false;

      setError(null);
      setNotice(null);
      // Shown in the same progress row as a file upload — from the user's side
      // it is the same operation, only the source differs.
      setUploadingName(shortenUrl(trimmed));

      try {
        const res = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, url: trimmed }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setError(data.error || "That link could not be imported.");
          return false;
        }

        if (activeSession.current !== sessionId) return false;
        setDocuments((prev) => [data.document, ...prev]);
        setNotice(data.message || "Document imported.");
        return true;
      } catch (err) {
        console.error("URL import failed:", err);
        setError("That link could not be imported. Check your connection and try again.");
        return false;
      } finally {
        setUploadingName(null);
      }
    },
    [sessionId]
  );

  const remove = useCallback(
    async (docId: string) => {
      const previous = documents;
      // Optimistic: the row disappears immediately and is restored on failure.
      setDocuments((docs) => docs.filter((doc) => doc.id !== docId));
      setError(null);
      setNotice(null);

      try {
        const res = await fetch(
          `/api/documents/${docId}?sessionId=${encodeURIComponent(sessionId)}`,
          { method: "DELETE" }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setDocuments(previous);
          setError(data.error || "That document could not be removed.");
        }
      } catch (err) {
        console.error("Delete failed:", err);
        setDocuments(previous);
        setError("That document could not be removed. Check your connection and try again.");
      }
    },
    [documents, sessionId]
  );

  return {
    documents,
    limits,
    isLoading,
    uploadingName,
    error,
    notice,
    upload,
    importUrl,
    remove,
    clearMessages,
  };
}

/** Host + last path segment — a full URL overflows the progress row. */
function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last ? `${parsed.hostname}/${last}` : parsed.hostname;
  } catch {
    return url.slice(0, 60);
  }
}
