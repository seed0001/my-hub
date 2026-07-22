"use client";

import { useMemo, useState } from "react";
import type { BookmarkDTO } from "@/lib/types";
import Modal from "@/components/Modal";

const empty = { title: "", url: "", note: "", category: "", tags: "" };

export default function Bookmarks({
  bookmarks,
  setBookmarks,
}: {
  bookmarks: BookmarkDTO[];
  setBookmarks: React.Dispatch<React.SetStateAction<BookmarkDTO[]>>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>("ALL");

  const categories = useMemo(() => {
    const set = new Set<string>();
    bookmarks.forEach((b) => b.category && set.add(b.category));
    return Array.from(set).sort();
  }, [bookmarks]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookmarks.filter((b) => {
      if (activeCat !== "ALL" && b.category !== activeCat) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.tags.some((t) => t.toLowerCase().includes(q)) ||
        (b.note || "").toLowerCase().includes(q)
      );
    });
  }, [bookmarks, query, activeCat]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.url.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          tags: form.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setBookmarks((prev) => [data.bookmark, ...prev]);
        setForm(empty);
        setModalOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/bookmarks/${id}`, { method: "DELETE" });
    if (res.ok) setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          className="input sm:max-w-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bookmarks…"
        />
        <button
          onClick={() => setModalOpen(true)}
          className="btn-primary w-full py-2.5 sm:w-auto"
        >
          + Add bookmark
        </button>
      </div>

      {categories.length > 0 && (
        <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4">
          <CatChip
            active={activeCat === "ALL"}
            onClick={() => setActiveCat("ALL")}
            label={`All (${bookmarks.length})`}
          />
          {categories.map((c) => (
            <CatChip
              key={c}
              active={activeCat === c}
              onClick={() => setActiveCat(c)}
              label={`${c} (${bookmarks.filter((b) => b.category === c).length})`}
            />
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
          <div className="text-3xl">🔖</div>
          <p className="text-hub-muted">
            {bookmarks.length === 0
              ? "No bookmarks yet. Save your favorite links here."
              : "No bookmarks match your search."}
          </p>
          {bookmarks.length === 0 && (
            <button onClick={() => setModalOpen(true)} className="btn-primary">
              Add your first bookmark
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((b) => (
            <div key={b.id} className="card group flex items-start gap-3 p-3">
              <img
                src={
                  b.favicon ||
                  `https://www.google.com/s2/favicons?domain=${
                    (() => {
                      try {
                        return new URL(b.url).hostname;
                      } catch {
                        return "";
                      }
                    })()
                  }&sz=64`
                }
                alt=""
                width={20}
                height={20}
                className="mt-0.5 h-5 w-5 shrink-0 rounded"
                onError={(e) => (e.currentTarget.style.visibility = "hidden")}
              />
              <div className="min-w-0 flex-1">
                <a
                  href={b.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-medium hover:text-hub-accent"
                  title={b.title}
                >
                  {b.title}
                </a>
                <a
                  href={b.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-xs text-hub-muted hover:underline"
                >
                  {b.url.replace(/^https?:\/\//, "")}
                </a>
                {b.note && (
                  <p className="mt-1 line-clamp-2 text-xs text-slate-400">{b.note}</p>
                )}
                {(b.category || b.tags.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {b.category && (
                      <span className="chip !py-0 text-[11px]">{b.category}</span>
                    )}
                    {b.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-hub-accent/10 px-2 py-0 text-[11px] text-hub-accent"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => remove(b.id)}
                className="shrink-0 rounded-md p-1.5 text-hub-muted transition-opacity hover:bg-red-950/40 hover:text-red-300 sm:opacity-0 sm:group-hover:opacity-100"
                title="Delete"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add bookmark">
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="label">URL</label>
            <input
              className="input"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="example.com or https://…"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Title</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Leave blank to use the domain"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Category</label>
              <input
                className="input"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="Tools, Reading…"
              />
            </div>
            <div>
              <label className="label">Tags (comma-separated)</label>
              <input
                className="input"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="ai, design, ref"
              />
            </div>
          </div>
          <div>
            <label className="label">Note</label>
            <textarea
              className="input min-h-[60px] resize-y"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Why is this worth keeping?"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save bookmark"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function CatChip({
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
