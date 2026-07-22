"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessageDTO } from "@/lib/types";

type Msg = {
  role: "user" | "assistant";
  content: string;
  /** Live tool-action labels (e.g. Created project “X”) for this reply. */
  actions?: string[];
};

export default function ChatPanel({
  aiEnabled,
  initialMessages,
  pendingPrompt,
  onPromptConsumed,
  onRefresh,
}: {
  aiEnabled: boolean;
  initialMessages: ChatMessageDTO[];
  pendingPrompt?: string | null;
  onPromptConsumed?: () => void;
  onRefresh?: (scopes: string[]) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>(
    initialMessages.map((m) => ({ role: m.role, content: m.content }))
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  // A suggestion tapped elsewhere (e.g. the Today screen) lands here.
  useEffect(() => {
    if (pendingPrompt) {
      setInput(pendingPrompt);
      onPromptConsumed?.();
      inputRef.current?.focus();
    }
  }, [pendingPrompt, onPromptConsumed]);

  function patchLast(fn: (m: Msg) => Msg) {
    setMessages((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      return copy;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setError(null);
    setInput("");
    setMessages((m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: "", actions: [] },
    ]);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "The assistant couldn't respond.");
        setMessages((m) => m.slice(0, -1));
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handle = (line: string) => {
        if (!line.trim()) return;
        let ev: { t: string; [k: string]: unknown };
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (ev.t === "text" && typeof ev.d === "string") {
          const d = ev.d as string;
          patchLast((m) => ({ ...m, content: m.content + d }));
        } else if (ev.t === "tool" && typeof ev.label === "string") {
          const label = ev.label as string;
          patchLast((m) => ({ ...m, actions: [...(m.actions || []), label] }));
        } else if (ev.t === "refresh" && Array.isArray(ev.scopes)) {
          onRefresh?.(ev.scopes as string[]);
        } else if (ev.t === "error" && typeof ev.message === "string") {
          setError(ev.message as string);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        lines.forEach(handle);
      }
      if (buffer.trim()) handle(buffer);

      // Drop the bubble if nothing at all came back.
      setMessages((m) => {
        const last = m[m.length - 1];
        if (
          last?.role === "assistant" &&
          !last.content &&
          !(last.actions && last.actions.length)
        ) {
          return m.slice(0, -1);
        }
        return m;
      });
    } catch {
      setError("Connection interrupted.");
      setMessages((m) =>
        m[m.length - 1]?.content === "" ? m.slice(0, -1) : m
      );
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
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {messages.length > 0 && (
          <div className="flex justify-center">
            <button
              onClick={clearChat}
              className="rounded-full border border-hub-border bg-hub-panel px-3 py-1 text-xs text-hub-muted transition-colors hover:text-white"
            >
              Clear conversation
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="mt-6 space-y-3 text-center">
            <div className="text-3xl">✦</div>
            <p className="text-sm text-hub-muted">
              I can act on your hub: create projects, draft roadmap docs,
              save bookmarks, set reminders, and run focus sessions.
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
                  "Turn my latest idea into a project roadmap",
                  "What should I focus on today?",
                  "Start a 25 minute focus session on my top project",
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
            <div className="max-w-[85%]">
              {m.actions && m.actions.length > 0 && (
                <div className="mb-1.5 space-y-1">
                  {m.actions.map((a, j) => (
                    <div
                      key={j}
                      className="flex items-center gap-1.5 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-2.5 py-1.5 text-xs text-emerald-300"
                    >
                      <span>✓</span>
                      <span className="min-w-0 flex-1">{a}</span>
                    </div>
                  ))}
                </div>
              )}
              {(m.content || !m.actions?.length) && (
                <div
                  className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
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
            ref={inputRef}
            className="input max-h-32 min-h-[44px] resize-none"
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
