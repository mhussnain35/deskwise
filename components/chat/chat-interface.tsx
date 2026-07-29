"use client";

import React, { useState, useEffect, useRef } from "react";
import { Send, Bot, User, Sparkles, RefreshCw, FileText, ChevronDown, ChevronUp, ExternalLink, ShieldCheck } from "lucide-react";

interface Citation {
  id: string;
  title: string;
  section: string;
  content: string;
  score: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  citations?: Citation[];
}

const SAMPLE_PROMPTS = [
  "How do I upgrade my subscription plan?",
  "What is your refund policy for unused months?",
  "Why did my credit card payment fail?",
  "How do I request a tax invoice?",
];

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let storedSession = localStorage.getItem("deskwise_session_id");
    if (!storedSession) {
      storedSession = "session_" + Math.random().toString(36).substring(2, 9);
      localStorage.setItem("deskwise_session_id", storedSession);
    }
    setSessionId(storedSession);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || isLoading) return;

    const userMessageId = "msg_" + Date.now();
    const userMsg: Message = { id: userMessageId, role: "user", content: query };

    const assistantMessageId = "msg_" + (Date.now() + 1);
    const assistantMsg: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: query, sessionId }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Parse citations header if provided
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
            msg.id === assistantMessageId
              ? { ...msg, content: msg.content + textChunk }
              : msg
          )
        );
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, isStreaming: false, citations: parsedCitations }
            : msg
        )
      );
    } catch (err: any) {
      console.error("Chat request failed:", err);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content: "Sorry, an error occurred while streaming the response. Please try again.",
                isStreaming: false,
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    const newSession = "session_" + Math.random().toString(36).substring(2, 9);
    localStorage.setItem("deskwise_session_id", newSession);
    setSessionId(newSession);
  };

  return (
    <div className="flex flex-col h-screen max-w-5xl mx-auto w-full bg-slate-950 text-slate-100 font-sans shadow-2xl overflow-hidden border-x border-slate-800/60">
      {/* Top Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-lg tracking-tight text-white">Deskwise</h1>
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> RAG Enabled
              </span>
            </div>
            <p className="text-xs text-slate-400">SaaS Billing & Support Agent</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 bg-slate-800/40 px-3 py-1.5 rounded-lg border border-slate-800">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Session: <code className="text-slate-300 font-mono">{sessionId.slice(0, 12)}</code></span>
          </div>

          <button
            onClick={handleClearChat}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 rounded-lg border border-slate-700/50 transition-colors"
            title="Reset conversation session"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>New Chat</span>
          </button>
        </div>
      </header>

      {/* Message Area */}
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-800">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full max-w-md mx-auto text-center space-y-6 py-12">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-inner">
              <Sparkles className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-medium text-white mb-2">Welcome to Deskwise</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Your intelligent SaaS billing assistant powered by retrieval-augmented generation. Ask any question about pricing, upgrades, payment failures, or refunds.
              </p>
            </div>

            <div className="w-full space-y-2 pt-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                Suggested Prompts
              </p>
              {SAMPLE_PROMPTS.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(prompt)}
                  className="w-full text-left text-xs text-slate-300 bg-slate-900/80 hover:bg-indigo-950/40 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/30 px-4 py-3 rounded-xl transition-all duration-150 flex items-center justify-between group"
                >
                  <span>{prompt}</span>
                  <Send className="w-3.5 h-3.5 text-slate-600 group-hover:text-indigo-400 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-start gap-3.5 ${
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              {/* Avatar */}
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs shrink-0 ${
                  msg.role === "user"
                    ? "bg-slate-700 text-slate-200"
                    : "bg-gradient-to-tr from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/10"
                }`}
              >
                {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              {/* Message Bubble & Citations */}
              <div className="flex flex-col space-y-2 max-w-[85%] sm:max-w-[78%]">
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white rounded-tr-xs"
                      : "bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-xs shadow-sm"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.isStreaming && (
                    <span className="inline-block w-2 h-4 ml-1 bg-indigo-400 animate-pulse rounded-xs vertical-middle" />
                  )}
                </div>

                {/* Source Citations Box */}
                {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
                  <CitationsList citations={msg.citations} />
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Form */}
      <footer className="p-4 sm:p-6 bg-slate-900/80 border-t border-slate-800/80 backdrop-blur-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="relative flex items-center"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about subscription plans, billing, or refunds..."
            rows={1}
            disabled={isLoading}
            className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20 text-slate-100 placeholder-slate-500 rounded-xl py-3.5 pl-4 pr-12 text-sm outline-none resize-none transition-all duration-150 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-2.5 p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-slate-800 disabled:text-slate-600 transition-all duration-150 shadow-md shadow-indigo-600/20"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 px-1">
          <span>Deskwise RAG • Gemini 2.0 Flash + Hybrid Search</span>
          <span>Press Enter to send</span>
        </div>
      </footer>
    </div>
  );
}

/** Expandable Source Citations Component */
function CitationsList({ citations }: { citations: Citation[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mt-1 border border-slate-800/80 bg-slate-900/40 rounded-xl p-3 text-xs">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full text-slate-400 hover:text-slate-200 font-medium transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-indigo-400" />
          <span>Retrieved {citations.length} Source Document{citations.length > 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-indigo-400">
          <span>{isExpanded ? "Hide Sources" : "View Sources"}</span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-2.5 pt-2 border-t border-slate-800/60">
          {citations.map((c, idx) => (
            <div
              key={c.id || idx}
              className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-1"
            >
              <div className="flex items-center justify-between text-slate-300 font-medium">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="w-4 h-4 rounded bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] shrink-0 font-mono">
                    {idx + 1}
                  </span>
                  <span className="truncate">{c.title}</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0 font-mono">
                  {(c.score * 100).toFixed(0)}% Match
                </span>
              </div>

              {c.section && (
                <p className="text-[11px] text-indigo-300/80 font-mono font-medium">
                  📌 {c.section}
                </p>
              )}

              <p className="text-slate-400 text-[11px] leading-relaxed line-clamp-3 bg-slate-900/60 p-2 rounded border border-slate-800/40">
                "{c.content}"
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
