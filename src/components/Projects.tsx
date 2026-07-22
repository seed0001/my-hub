"use client";

import { useState } from "react";
import type { ProjectDTO, ProjectStatus } from "@/lib/types";
import { STATUS_META, STATUS_ORDER } from "@/lib/types";
import Modal from "@/components/Modal";
import { timeAgo } from "@/lib/time";

const empty = {
  name: "",
  description: "",
  status: "IDEA" as ProjectStatus,
  url: "",
  repoUrl: "",
};

export default function Projects({
  projects,
  setProjects,
}: {
  projects: ProjectDTO[];
  setProjects: React.Dispatch<React.SetStateAction<ProjectDTO[]>>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectDTO | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<ProjectStatus | "ALL">("ALL");

  function openNew() {
    setEditing(null);
    setForm(empty);
    setModalOpen(true);
  }

  function openEdit(p: ProjectDTO) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description || "",
      status: p.status,
      url: p.url || "",
      repoUrl: p.repoUrl || "",
    });
    setModalOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        const res = await fetch(`/api/projects/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (res.ok) {
          setProjects((prev) =>
            prev.map((p) => (p.id === editing.id ? data.project : p))
          );
          setModalOpen(false);
        }
      } else {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (res.ok) {
          setProjects((prev) => [data.project, ...prev]);
          setModalOpen(false);
        }
      }
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      setProjects((prev) => prev.map((p) => (p.id === id ? data.project : p)));
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this project and its updates?")) return;
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (res.ok) setProjects((prev) => prev.filter((p) => p.id !== id));
  }

  const shown =
    filter === "ALL" ? projects : projects.filter((p) => p.status === filter);

  return (
    <div>
      <div className="mb-4 space-y-3">
        <button onClick={openNew} className="btn-primary w-full py-2.5 sm:w-auto">
          + New project
        </button>
        <div className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4">
          <FilterChip
            active={filter === "ALL"}
            onClick={() => setFilter("ALL")}
            label={`All (${projects.length})`}
          />
          {STATUS_ORDER.map((s) => {
            const count = projects.filter((p) => p.status === s).length;
            if (count === 0) return null;
            return (
              <FilterChip
                key={s}
                active={filter === s}
                onClick={() => setFilter(s)}
                label={`${STATUS_META[s].label} (${count})`}
              />
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState onAdd={openNew} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onEdit={() => openEdit(p)}
              onDelete={() => remove(p.id)}
              onPatch={(body) => patch(p.id, body)}
              onProjectsChange={setProjects}
            />
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit project" : "New project"}
      >
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My next big thing"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="input min-h-[80px] resize-y"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What is it, in a sentence or two?"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Status</label>
              <select
                className="input"
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as ProjectStatus })
                }
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Live URL</label>
              <input
                className="input"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://…"
              />
            </div>
            <div>
              <label className="label">Repo URL</label>
              <input
                className="input"
                value={form.repoUrl}
                onChange={(e) => setForm({ ...form, repoUrl: e.target.value })}
                placeholder="https://github.com/…"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create project"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-hub-accent bg-hub-accent/20 text-white"
          : "border-hub-border bg-hub-panel text-hub-muted hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="text-3xl">🚀</div>
      <p className="text-hub-muted">No projects here yet.</p>
      <button onClick={onAdd} className="btn-primary">
        Add your first project
      </button>
    </div>
  );
}

function ProjectCard({
  project,
  onEdit,
  onDelete,
  onPatch,
  onProjectsChange,
}: {
  project: ProjectDTO;
  onEdit: () => void;
  onDelete: () => void;
  onPatch: (body: Record<string, unknown>) => void;
  onProjectsChange: React.Dispatch<React.SetStateAction<ProjectDTO[]>>;
}) {
  const [updateText, setUpdateText] = useState("");
  const [showUpdate, setShowUpdate] = useState(false);
  const [posting, setPosting] = useState(false);
  const meta = STATUS_META[project.status];

  async function addUpdate() {
    const text = updateText.trim();
    if (!text) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json();
      if (res.ok) {
        onProjectsChange((prev) =>
          prev.map((p) =>
            p.id === project.id
              ? { ...p, updates: [data.update, ...p.updates].slice(0, 5) }
              : p
          )
        );
        setUpdateText("");
        setShowUpdate(false);
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="card flex flex-col p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPatch({ pinned: !project.pinned })}
              title={project.pinned ? "Unpin" : "Pin"}
              className={`-m-1 p-1 text-base ${project.pinned ? "text-amber-400" : "text-hub-muted hover:text-white"}`}
            >
              {project.pinned ? "★" : "☆"}
            </button>
            <h3 className="truncate font-semibold">{project.name}</h3>
          </div>
        </div>
        <span
          className={`chip whitespace-nowrap border ${meta.badge}`}
        >
          <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </div>

      {project.description && (
        <p className="mb-3 line-clamp-3 text-sm text-slate-300">
          {project.description}
        </p>
      )}

      {(project.url || project.repoUrl) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {project.url && (
            <a
              href={project.url}
              target="_blank"
              rel="noreferrer"
              className="chip hover:border-hub-accent hover:text-white"
            >
              ↗ Live
            </a>
          )}
          {project.repoUrl && (
            <a
              href={project.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="chip hover:border-hub-accent hover:text-white"
            >
              ⑂ Repo
            </a>
          )}
        </div>
      )}

      {project.updates.length > 0 && (
        <div className="mb-3 space-y-1.5 border-l-2 border-hub-border pl-3">
          {project.updates.slice(0, 3).map((u) => (
            <div key={u.id} className="text-sm">
              <span className="text-slate-300">{u.body}</span>
              <span className="ml-1.5 text-xs text-hub-muted">
                · {timeAgo(u.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {showUpdate ? (
        <div className="mb-3 flex gap-2">
          <input
            className="input"
            value={updateText}
            onChange={(e) => setUpdateText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addUpdate()}
            placeholder="Post a status update…"
            autoFocus
          />
          <button className="btn-primary" onClick={addUpdate} disabled={posting}>
            {posting ? "…" : "Post"}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowUpdate(true)}
          className="-mx-1 mb-2 self-start rounded-md px-1 py-1.5 text-[13px] text-hub-accent hover:underline"
        >
          + Add update
        </button>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-hub-border pt-3">
        <select
          className="rounded-md border border-hub-border bg-hub-bg/60 px-2 py-1.5 text-xs text-slate-200 focus:outline-none"
          value={project.status}
          onChange={(e) => onPatch({ status: e.target.value })}
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          <button
            onClick={onEdit}
            className="rounded-md px-3 py-1.5 text-xs text-hub-muted hover:bg-hub-border/50 hover:text-white"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="rounded-md px-3 py-1.5 text-xs text-red-400/80 hover:bg-red-950/40 hover:text-red-300"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
