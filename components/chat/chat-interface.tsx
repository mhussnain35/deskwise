"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bot,
  FolderOpen,
  Paperclip,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  UploadCloud,
  User,
  Zap,
} from "lucide-react";
import { CitationsList } from "./citations";
import { DocumentPanel, UPLOAD_ACCEPT } from "./document-panel";
import { ChatLoadingScreen } from "./loading-screen";
import { SPLASH_DURATION_MS, SplashScreen } from "./splash-screen";
import { DeskwiseMark } from "@/components/brand/deskwise-logo";
import { Markdown } from "./markdown";
import { useDocuments } from "./use-documents";
import { useVisualViewport } from "./use-visual-viewport";
import type { Citation, Message } from "./types";

/**
 * The chat shell is sized to the visible viewport, not the layout viewport, so
 * the composer sits directly above the on-screen keyboard instead of behind it.
 * `--app-height` / `--viewport-offset` are published by useVisualViewport.
 */
const SHELL_STYLE: React.CSSProperties = {
  height: "var(--app-height, 100dvh)",
  transform: "translateY(var(--viewport-offset, 0px))",
};

/**
 * Kept short enough to sit on a single line at 375px — a suggestion that wraps
 * to two lines reads as a paragraph rather than a tappable prompt.
 */
const SAMPLE_PROMPTS = [
  "How do I upgrade my plan?",
  "What's your refund policy?",
  "Why did my payment fail?",
  "How do I get a tax invoice?",
];

const SESSION_STORAGE_KEY = "deskwise_session_id";

/** A message consisting solely of a link — treated as "import this document". */
const BARE_URL = /^https?:\/\/[^\s]+$/i;

function newSessionId(): string {
  return "session_" + Math.random().toString(36).substring(2, 9);
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true); // cold-start / history load
  const [splashDone, setSplashDone] = useState(false);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [feedbackState, setFeedbackState] = useState<Record<string, "up" | "down">>({});
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerFileRef = useRef<HTMLInputElement>(null);
  const localIdCounter = useRef(0);
  const dragDepth = useRef(0);

  const documentsState = useDocuments(sessionId);
  const { documents, upload, importUrl, uploadingName } = documentsState;

  useVisualViewport();

  /** Client-side key for a message until the server hands back its database id. */
  const nextLocalId = () => `local_${localIdCounter.current++}`;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let storedSession = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!storedSession) {
        storedSession = newSessionId();
        localStorage.setItem(SESSION_STORAGE_KEY, storedSession);
      }

      // Load past conversation history (covers Neon cold-start latency)
      let history: Message[] = [];
      try {
        const data = await fetch(`/api/history/${storedSession}`).then((res) => res.json());
        if (Array.isArray(data?.messages)) history = data.messages;
      } catch (err) {
        console.warn("Could not load session history:", err);
      }

      if (cancelled) return;
      setSessionId(storedSession);
      setMessages(history);
      setIsInitializing(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // The splash runs on its own clock alongside the history fetch, rather than
  // after it — so on a warm load the two overlap and the wait costs nothing.
  useEffect(() => {
    const timer = window.setTimeout(() => setSplashDone(true), SPLASH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  /** Grow the composer with its content, up to roughly six lines. */
  const resizeComposer = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    resizeComposer();
  }, [input, resizeComposer]);

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || isLoading) return;

    // A message that is nothing but a link is a request to import that document
    // — the agent can't browse, so answering it as a question is useless.
    if (BARE_URL.test(query)) {
      setInput("");
      setIsPanelOpen(true);
      await importUrl(query);
      return;
    }

    const userMsg: Message = { id: nextLocalId(), role: "user", content: query };

    const assistantMessageId = nextLocalId();
    const assistantMsg: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsLoading(true);
    setRateLimitMsg(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: query, sessionId }),
      });

      // Handle rate limit gracefully (429) — both our own per-session limiter
      // and an upstream provider quota rejection arrive here.
      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        const retrySec = Math.ceil((data.retryAfterMs || 60000) / 1000);
        setRateLimitMsg(
          data.error || `You're sending messages too quickly. Please wait ${retrySec}s and try again.`
        );
        setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId));
        return;
      }

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "The service is temporarily unavailable. Please try again.");
      }

      // Swap the local placeholder id for the database id so feedback lands on
      // the right row — feedback.message_id is a uuid foreign key.
      const serverMessageId = response.headers.get("X-Message-Id");
      if (serverMessageId) {
        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, id: serverMessageId } : msg))
        );
      }
      const trackingId = serverMessageId || assistantMessageId;

      let parsedCitations: Citation[] = [];
      const citationsHeader = response.headers.get("X-Citations");
      if (citationsHeader) {
        try {
          parsedCitations = JSON.parse(decodeURIComponent(citationsHeader));
        } catch (e) {
          console.warn("Failed to parse X-Citations header:", e);
        }
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const textChunk = decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === trackingId ? { ...msg, content: msg.content + textChunk } : msg
          )
        );
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === trackingId
            ? { ...msg, isStreaming: false, citations: parsedCitations }
            : msg
        )
      );
    } catch (err) {
      console.error("Chat request failed:", err);
      const detail = err instanceof Error ? err.message : "Please try again.";
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, content: detail, isStreaming: false, failed: true }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedback = async (messageId: string, rating: "up" | "down") => {
    setFeedbackState((prev) => ({ ...prev, [messageId]: rating }));

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, rating }),
      });

      if (!res.ok) {
        // Roll the button back rather than show a rating that was never stored.
        setFeedbackState((prev) => {
          const next = { ...prev };
          delete next[messageId];
          return next;
        });
        console.error("Feedback rejected:", (await res.json().catch(() => ({}))).error);
      }
    } catch (err) {
      console.error("Failed to submit feedback:", err);
    }
  };

  /**
   * Enter sends on a keyboard, but inserts a newline on touch devices — on a
   * phone the return key is the only way to type a second line, and there is a
   * send button right there.
   */
  const isTouchDevice = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches,
    []
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isTouchDevice) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setRateLimitMsg(null);
    setFeedbackState({});
    const nextSession = newSessionId();
    localStorage.setItem(SESSION_STORAGE_KEY, nextSession);
    setSessionId(nextSession);
  };

  const handleComposerFiles = (files: FileList | null) => {
    if (files && files.length > 0) {
      void upload(files);
      setIsPanelOpen(true);
    }
    if (composerFileRef.current) composerFileRef.current.value = "";
  };

  // Whole-window drag and drop, so a file can be dropped anywhere on the chat.
  const handleDragEnter = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    dragDepth.current += 1;
    setIsDraggingFile(true);
  };

  const handleDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDraggingFile(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDraggingFile(false);
    if (event.dataTransfer.files?.length) {
      void upload(event.dataTransfer.files);
      setIsPanelOpen(true);
    }
  };

  /** Keep the latest turn visible when the keyboard pushes the view up. */
  const handleComposerFocus = () => {
    window.setTimeout(
      () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }),
      250
    );
  };

  // Start-up sequence: branded splash first, then the layout skeleton for as
  // long as the conversation is still loading.
  if (!splashDone) {
    return <SplashScreen />;
  }

  if (isInitializing) {
    return <ChatLoadingScreen />;
  }

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={SHELL_STYLE}
      className="fixed inset-x-0 top-0 mx-auto flex w-full max-w-5xl flex-col overflow-hidden bg-slate-950 font-sans text-slate-100 shadow-2xl sm:border-x sm:border-slate-800/60"
    >
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-900/70 px-3 py-2.5 backdrop-blur-md sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <DeskwiseMark className="h-9 w-9 shrink-0 shadow-lg shadow-indigo-500/20 sm:h-10 sm:w-10" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold tracking-tight text-white sm:text-lg">
                Deskwise
              </h1>
              <span className="hidden items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-400 xs:flex">
                <ShieldCheck className="h-3 w-3" /> RAG
              </span>
            </div>
            <p className="truncate text-[11px] text-slate-400 sm:text-xs">
              SaaS Billing &amp; Support Agent
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            onClick={() => setIsPanelOpen(true)}
            title="Your uploaded documents"
            className="relative flex items-center gap-1.5 rounded-lg border border-slate-700/60 bg-slate-800/80 px-2.5 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-800 hover:text-white sm:px-3 sm:py-1.5"
          >
            <FolderOpen className="h-4 w-4 text-indigo-400 sm:h-3.5 sm:w-3.5" />
            <span className="hidden sm:inline">Documents</span>
            {documents.length > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-semibold text-white">
                {documents.length}
              </span>
            )}
          </button>

          <Link
            href="/admin"
            title="KB admin panel"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/60 bg-slate-800/80 px-2.5 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-800 hover:text-white sm:px-3 sm:py-1.5"
          >
            <Settings className="h-4 w-4 text-indigo-400 sm:h-3.5 sm:w-3.5" />
            <span className="hidden sm:inline">Admin</span>
          </Link>

          <button
            onClick={handleClearChat}
            title="Start a new conversation"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/50 bg-slate-800/60 px-2.5 py-2 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 sm:px-3 sm:py-1.5"
          >
            <RefreshCw className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            <span className="hidden sm:inline">New chat</span>
          </button>
        </div>
      </header>

      {/* Messages */}
      <main className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-5 sm:space-y-6 sm:px-6 sm:py-6">
        {messages.length === 0 ? (
          <EmptyState
            onPrompt={(prompt) => handleSendMessage(prompt)}
            onUpload={() => setIsPanelOpen(true)}
            documentCount={documents.length}
          />
        ) : (
          messages.map((msg) => (
            <MessageRow
              key={msg.id}
              message={msg}
              rating={feedbackState[msg.id]}
              onFeedback={handleFeedback}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Composer — last child of the viewport-height column, so it sits flush
          against the bottom of the visible area (above the keyboard on mobile). */}
      <footer className="shrink-0 border-t border-slate-800/80 bg-slate-900/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:px-6 sm:pb-5 sm:pt-4">
        {rateLimitMsg && (
          <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
            <span className="shrink-0 text-amber-400">⚠️</span>
            <span className="flex-1">{rateLimitMsg}</span>
            <button
              onClick={() => setRateLimitMsg(null)}
              aria-label="Dismiss"
              className="shrink-0 text-amber-500 hover:text-amber-300"
            >
              ✕
            </button>
          </div>
        )}

        {uploadingName && (
          <button
            onClick={() => setIsPanelOpen(true)}
            className="mb-2.5 flex w-full items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-left text-xs text-indigo-300"
          >
            <UploadCloud className="h-3.5 w-3.5 shrink-0 animate-pulse" />
            <span className="truncate">Indexing &ldquo;{uploadingName}&rdquo;…</span>
          </button>
        )}

        {/* Standard messenger composer: a rounded input holding the attach
            control, with the send action as a separate circular button. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-end gap-2"
        >
          <div className="flex min-w-0 flex-1 items-end rounded-3xl border border-slate-800 bg-slate-950 pl-1 pr-2 transition-colors focus-within:border-indigo-500/60">
            <button
              type="button"
              onClick={() => composerFileRef.current?.click()}
              aria-label="Attach a document"
              title="Attach a document to ask questions about"
              className="shrink-0 rounded-full p-2.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-indigo-300 active:bg-slate-800"
            >
              <Paperclip className="h-5 w-5" />
            </button>

            <input
              ref={composerFileRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              className="hidden"
              onChange={(event) => handleComposerFiles(event.target.files)}
            />

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={handleComposerFocus}
              placeholder={documents.length > 0 ? "Ask about your documents…" : "Message Deskwise…"}
              rows={1}
              disabled={isLoading}
              aria-label="Message"
              /* 16px base font size keeps iOS Safari from zooming on focus. */
              className="max-h-32 min-h-[2.75rem] flex-1 resize-none bg-transparent py-3 text-base leading-5 text-slate-100 placeholder-slate-500 outline-none disabled:opacity-50 sm:text-sm sm:leading-5"
            />
          </div>

          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            aria-label="Send message"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-indigo-600 text-white shadow-md shadow-indigo-600/20 transition-colors hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:shadow-none"
          >
            <Send className="h-[18px] w-[18px]" />
          </button>
        </form>

        {/* Provider/limit detail is desk-side context, not something a phone
            keyboard should be competing with for vertical space. */}
        <div className="mt-2 hidden items-center justify-between gap-3 px-1 text-[11px] text-slate-500 sm:flex">
          <span className="truncate">OpenRouter · hybrid retrieval</span>
          <span className="shrink-0 text-slate-600">10 msg/min per session</span>
        </div>
      </footer>

      {/* Drag overlay */}
      {isDraggingFile && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-indigo-400 px-8 py-10">
            <UploadCloud className="h-10 w-10 text-indigo-400" />
            <p className="text-sm font-medium text-white">Drop your document to ask about it</p>
            <p className="text-xs text-slate-400">PDF, DOCX, Markdown, TXT, CSV, JSON or HTML</p>
          </div>
        </div>
      )}

      <DocumentPanel
        open={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        state={documentsState}
      />
    </div>
  );
}

function EmptyState({
  onPrompt,
  onUpload,
  documentCount,
}: {
  onPrompt: (prompt: string) => void;
  onUpload: () => void;
  documentCount: number;
}) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center space-y-6 py-8 text-center">
      <div className="relative">
        <DeskwiseMark className="h-16 w-16 shadow-xl shadow-indigo-500/20" />
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-slate-950 bg-emerald-500">
          <Zap className="h-2.5 w-2.5 text-white" />
        </span>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold text-white sm:text-xl">Welcome to Deskwise</h2>
        <p className="text-sm leading-relaxed text-slate-400">
          Ask about billing and subscriptions, or upload your own document and ask about that.
          Every answer cites the sections it came from.
        </p>
      </div>

      <button
        onClick={onUpload}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20"
      >
        <UploadCloud className="h-4 w-4" />
        {documentCount > 0
          ? `${documentCount} document${documentCount === 1 ? "" : "s"} attached — manage`
          : "Upload a document or paste a link"}
      </button>

      <div className="w-full space-y-2">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Try asking
        </p>
        {SAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPrompt(prompt)}
            title={prompt}
            className="group flex w-full items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-left text-sm text-slate-300 transition-all duration-150 hover:border-indigo-500/30 hover:bg-indigo-950/40 hover:text-indigo-200"
          >
            {/* One line per suggestion — truncated rather than wrapped. */}
            <span className="truncate whitespace-nowrap">{prompt}</span>
            <Send className="h-3.5 w-3.5 shrink-0 text-slate-600 transition-colors group-hover:text-indigo-400" />
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({
  message,
  rating,
  onFeedback,
}: {
  message: Message;
  rating?: "up" | "down";
  onFeedback: (messageId: string, rating: "up" | "down") => void;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex items-start gap-2.5 sm:gap-3.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs ${
          isUser
            ? "bg-slate-700 text-slate-200"
            : "bg-gradient-to-tr from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/10"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div
        className={`flex min-w-0 max-w-[calc(100%-3rem)] flex-col space-y-2 sm:max-w-[78%] ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div
          className={`w-fit max-w-full break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:px-4 sm:py-3 ${
            isUser
              ? "rounded-tr-sm bg-indigo-600 text-white"
              : message.failed
                ? "rounded-tl-sm border border-rose-500/30 bg-rose-500/10 text-rose-200"
                : "rounded-tl-sm border border-slate-800 bg-slate-900 text-slate-200 shadow-sm"
          }`}
        >
          {isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : (
            <Markdown text={message.content} />
          )}
          {message.isStreaming && (
            <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-indigo-400 align-middle" />
          )}
        </div>

        {!isUser && !message.isStreaming && (
          <div className="w-full space-y-2">
            {message.citations && message.citations.length > 0 && (
              <CitationsList citations={message.citations} />
            )}

            {!message.failed && (
              <div className="flex items-center gap-1.5 pt-0.5 text-slate-500">
                <span className="text-[10px]">Was this helpful?</span>
                <button
                  onClick={() => onFeedback(message.id, "up")}
                  aria-label="Helpful"
                  aria-pressed={rating === "up"}
                  className={`rounded p-1.5 transition-colors hover:bg-slate-800 hover:text-slate-200 ${
                    rating === "up" ? "bg-emerald-500/10 text-emerald-400" : ""
                  }`}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onFeedback(message.id, "down")}
                  aria-label="Not helpful"
                  aria-pressed={rating === "down"}
                  className={`rounded p-1.5 transition-colors hover:bg-slate-800 hover:text-slate-200 ${
                    rating === "down" ? "bg-rose-500/10 text-rose-400" : ""
                  }`}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
