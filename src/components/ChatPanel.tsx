"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessageDTO } from "@/lib/types";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatPanel({
  aiEnabled,
  initialMessages,
}: {
  aiEnabled: boolean;
  initialMessages: ChatMessageDTO[];
}) {
  const [messages, setMessages] = useState<Msg[]>(
    initialMessages.map((m) => ({ role: m.role, content: m.content }))
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "The assistant couldn't respond.");
        // Drop the empty assistant placeholder.
        setMessages((m) => m.slice(0, -1));
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: "assistant",
            content: copy[copy.length - 1].content + chunk,
          };
          return copy;
        });
      }
    } catch {
      setError("Connection interrupted.");
      setMessages((m) => (m[m.length - 1]?.content === "" ? m.slice(0, -1) : m));
    } finally {
      setStreaming(false);
    }
  }

  async function clearChat() {
    if (!confirm("Clear the whole conversation?")) return;
    await fetch("/api/chat", { method: "DELETE" });
    setMessages([]);
  }

  return (
    <div className="flex h-full flex-col bg-hub-panel/40">
      <div className="flex items-center justify-between border-b border-hub-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-hub-accent to-hub-accent2 text-sm">
            ✦
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Hub Assistant</p>
            <p className="mt-0.5 text-[11px] text-hub-muted">
              Knows your projects & bookmarks
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-xs text-hub-muted hover:text-white"
          >
            Clear
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mt-6 space-y-3 text-center">
            <div className="text-3xl">✦</div>
            <p className="text-sm text-hub-muted">
              Ask me to summarize your projects, suggest what to work on next, or
              help you organize your bookmarks.
            </p>
            {!aiEnabled && (
              <p className="mx-auto max-w-xs rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
                AI isn&apos;t configured yet. Add an <code>OPENROUTER_API_KEY</code>{" "}
                env var to enable the assistant.
              </p>
            )}
            {aiEnabled && (
              <div className="flex flex-col gap-2">
                {[
                  "What should I focus on today?",
                  "Summarize the status of all my projects",
                  "Which projects have been paused?",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="rounded-lg border border-hub-border bg-hub-panel px-3 py-2 text-left text-xs text-slate-300 hover:border-hub-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                m.role === "user"
                  ? "bg-hub-accent text-white"
                  : "border border-hub-border bg-hub-panel text-slate-200"
              }`}
            >
              {m.content || (
                <span className="inline-flex gap-1">
                  <Dot /> <Dot /> <Dot />
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="mx-4 mb-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="border-t border-hub-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            className="input max-h-32 min-h-[42px] resize-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={aiEnabled ? "Ask your hub anything…" : "AI not configured"}
            disabled={!aiEnabled || streaming}
            rows={1}
          />
          <button
            onClick={send}
            disabled={!aiEnabled || streaming || !input.trim()}
            className="btn-primary shrink-0"
          >
            {streaming ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Dot() {
  return (
    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-hub-muted" />
  );
}
