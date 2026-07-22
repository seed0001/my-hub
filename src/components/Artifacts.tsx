"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ArtifactDTO } from "@/lib/types";
import { ARTIFACT_KIND_META } from "@/lib/types";
import { timeAgo } from "@/lib/time";

function CopyButton({ text, compact }: { text: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Older mobile browsers: fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }

  if (compact) {
    return (
      <button
        onClick={copy}
        title="Copy to clipboard"
        aria-label="Copy to clipboard"
        className={`shrink-0 rounded-md p-1.5 transition-colors ${
          copied ? "text-emerald-300" : "text-hub-muted hover:text-white"
        }`}
      >
        {copied ? "✓" : <CopyIcon />}
      </button>
    );
  }
  return (
    <button
      onClick={copy}
      className={`btn py-1.5 text-xs ${
        copied
          ? "border border-emerald-700 bg-emerald-950/40 text-emerald-300"
          : "bg-hub-accent text-white hover:bg-indigo-500"
      }`}
    >
      {copied ? "✓ Copied" : "⧉ Copy"}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export default function Artifacts({
  artifacts,
  setArtifacts,
  onAsk,
}: {
  artifacts: ArtifactDTO[];
  setArtifacts: React.Dispatch<React.SetStateAction<ArtifactDTO[]>>;
  onAsk: (prompt: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = artifacts.find((a) => a.id === openId) || null;

  if (open) {
    return (
      <ArtifactView
        artifact={open}
        onBack={() => setOpenId(null)}
        onAsk={onAsk}
        onSaved={(updated) =>
          setArtifacts((prev) =>
            prev.map((a) => (a.id === updated.id ? updated : a))
          )
        }
        onDeleted={() => {
          setArtifacts((prev) => prev.filter((a) => a.id !== open.id));
          setOpenId(null);
        }}
      />
    );
  }

  return (
    <div>
      {artifacts.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
          <div className="text-3xl">📄</div>
          <p className="text-sm text-hub-muted">
            No docs yet. Ask the assistant to turn an idea into a roadmap or a
            build prompt — everything it writes lands here with an artifact ID
            and a copy button, ready to paste to your coding agent.
          </p>
          <button
            onClick={() => onAsk("Help me turn one of my ideas into a project roadmap")}
            className="btn-primary"
          >
            ✦ Draft a roadmap
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {artifacts.map((a) => {
            const meta = ARTIFACT_KIND_META[a.kind] || ARTIFACT_KIND_META.doc;
            return (
              <div
                key={a.id}
                onClick={() => setOpenId(a.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setOpenId(a.id)}
                className="card flex w-full cursor-pointer items-center gap-3 p-3.5 text-left transition-colors active:bg-hub-panel2"
              >
                <span className="shrink-0 rounded-md border border-hub-border bg-hub-panel2 px-2 py-1 font-mono text-[11px] text-hub-muted">
                  A-{a.num}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.title}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-hub-muted">
                    <span className={`chip !py-0 border ${meta.badge}`}>
                      {meta.label}
                    </span>
                    {a.project && (
                      <span className="truncate">{a.project.name}</span>
                    )}
                    <span>· {timeAgo(a.updatedAt)}</span>
                  </span>
                </span>
                <CopyButton text={a.content} compact />
                <span className="text-hub-muted">›</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ArtifactView({
  artifact,
  onBack,
  onAsk,
  onSaved,
  onDeleted,
}: {
  artifact: ArtifactDTO;
  onBack: () => void;
  onAsk: (prompt: string) => void;
  onSaved: (a: ArtifactDTO) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(artifact.content);
  const [saving, setSaving] = useState(false);
  const meta = ARTIFACT_KIND_META[artifact.kind] || ARTIFACT_KIND_META.doc;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      const data = await res.json();
      if (res.ok) {
        onSaved(data.artifact);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete A-${artifact.num} “${artifact.title}”?`)) return;
    const res = await fetch(`/api/artifacts/${artifact.id}`, {
      method: "DELETE",
    });
    if (res.ok) onDeleted();
  }

  return (
    <div>
      {/* Doc header */}
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            onClick={onBack}
            className="-mx-1 mb-1 rounded px-1 py-0.5 text-xs text-hub-accent"
          >
            ‹ All docs
          </button>
          <h2 className="text-lg font-semibold leading-snug">{artifact.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-hub-muted">
            <span className="rounded-md border border-hub-border bg-hub-panel2 px-1.5 py-0.5 font-mono text-[11px]">
              A-{artifact.num}
            </span>
            <span className={`chip !py-0 border ${meta.badge}`}>{meta.label}</span>
            {artifact.project && <span>{artifact.project.name}</span>}
            <span>updated {timeAgo(artifact.updatedAt)}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mb-4 flex flex-wrap gap-2">
        <CopyButton text={artifact.content} />
        <button
          onClick={() =>
            onAsk(`Let's refine artifact A-${artifact.num} (“${artifact.title}”). `)
          }
          className="btn-ghost py-1.5 text-xs"
        >
          ✦ Refine with AI
        </button>
        {editing ? (
          <>
            <button
              onClick={save}
              disabled={saving}
              className="btn-ghost py-1.5 text-xs"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                setDraft(artifact.content);
                setEditing(false);
              }}
              className="btn-ghost py-1.5 text-xs"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="btn-ghost py-1.5 text-xs"
          >
            Edit
          </button>
        )}
        <button onClick={remove} className="btn-danger py-1.5 text-xs">
          Delete
        </button>
      </div>

      {/* Content */}
      {editing ? (
        <textarea
          className="input min-h-[50dvh] w-full resize-y font-mono text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <div className="card markdown p-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {artifact.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
