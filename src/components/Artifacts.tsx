"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ArtifactDTO } from "@/lib/types";
import { ARTIFACT_KIND_META } from "@/lib/types";
import { timeAgo } from "@/lib/time";

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
            No docs yet. Ask the assistant to turn an idea into a roadmap and
            it'll show up here with an artifact ID.
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
              <button
                key={a.id}
                onClick={() => setOpenId(a.id)}
                className="card flex w-full items-center gap-3 p-3.5 text-left transition-colors active:bg-hub-panel2"
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
                <span className="text-hub-muted">›</span>
              </button>
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
        <button
          onClick={() =>
            onAsk(`Let's refine artifact A-${artifact.num} (“${artifact.title}”). `)
          }
          className="btn-primary py-1.5 text-xs"
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
