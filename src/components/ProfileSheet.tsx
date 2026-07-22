"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Modal from "@/components/Modal";
import { timeAgo } from "@/lib/time";

interface MemoryRow {
  id: string;
  content: string;
  createdAt: string;
}

export default function ProfileSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState("");
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setEditing(false);
    Promise.all([
      fetch("/api/profile").then((r) => r.json()),
      fetch("/api/memories").then((r) => r.json()),
    ])
      .then(([p, m]) => {
        setProfile(p.profile?.content || "");
        setMemories(m.memories || []);
      })
      .finally(() => setLoading(false));
  }, [open]);

  async function saveProfile() {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (res.ok) {
        setProfile(draft);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function forget(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    await fetch(`/api/memories/${id}`, { method: "DELETE" });
  }

  return (
    <Modal open={open} onClose={onClose} title="Your profile">
      {loading ? (
        <p className="py-8 text-center text-sm text-hub-muted">Loading…</p>
      ) : (
        <div className="space-y-5">
          {/* AI-built profile */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-hub-muted">
                Built by your assistant
              </h3>
              {editing ? (
                <div className="flex gap-2">
                  <button
                    onClick={saveProfile}
                    disabled={saving}
                    className="text-xs font-medium text-hub-accent"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="text-xs text-hub-muted"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setDraft(profile);
                    setEditing(true);
                  }}
                  className="text-xs text-hub-muted hover:text-white"
                >
                  Edit
                </button>
              )}
            </div>
            {editing ? (
              <textarea
                className="input min-h-[30dvh] w-full resize-y font-mono text-sm"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="## About&#10;…"
              />
            ) : profile.trim() ? (
              <div className="markdown rounded-lg border border-hub-border bg-hub-bg/40 p-3">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {profile}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="rounded-lg border border-hub-border bg-hub-bg/40 p-3 text-sm text-hub-muted">
                Empty so far. As you chat, the assistant fills this in with who
                you are, where you live, your interests, hobbies, and how you
                like to work.
              </p>
            )}
          </section>

          {/* Memories */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-hub-muted">
              Memories ({memories.length})
            </h3>
            {memories.length === 0 ? (
              <p className="text-sm text-hub-muted">
                No memories yet — they accumulate automatically as you chat.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {memories.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-start gap-2 rounded-lg border border-hub-border bg-hub-bg/40 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 text-sm text-slate-200">
                      {m.content}
                      <span className="ml-1.5 text-xs text-hub-muted">
                        · {timeAgo(m.createdAt)}
                      </span>
                    </span>
                    <button
                      onClick={() => forget(m.id)}
                      className="shrink-0 rounded p-1 text-xs text-hub-muted hover:text-red-300"
                      title="Forget"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
