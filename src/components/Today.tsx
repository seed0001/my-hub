"use client";

import type { BookmarkDTO, ProjectDTO } from "@/lib/types";
import { STATUS_META } from "@/lib/types";
import { timeAgo } from "@/lib/time";

const SUGGESTIONS = [
  "What should I focus on today?",
  "Summarize where all my projects stand",
  "What haven't I touched in a while?",
];

export default function Today({
  displayName,
  aiEnabled,
  projects,
  bookmarks,
  onAsk,
  onNavigate,
}: {
  displayName: string;
  aiEnabled: boolean;
  projects: ProjectDTO[];
  bookmarks: BookmarkDTO[];
  onAsk: (prompt: string) => void;
  onNavigate: (tab: "chat" | "projects" | "bookmarks") => void;
}) {
  const hour = new Date().getHours();
  const greeting =
    hour < 5
      ? "Up late"
      : hour < 12
        ? "Good morning"
        : hour < 18
          ? "Good afternoon"
          : "Good evening";
  const dateLine = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const activeCount = projects.filter((p) => p.status === "ACTIVE").length;

  // Pinned first, then anything in motion.
  const focus = [
    ...projects.filter((p) => p.pinned),
    ...projects.filter(
      (p) => !p.pinned && (p.status === "ACTIVE" || p.status === "PLANNING")
    ),
  ].slice(0, 5);

  const recent = projects
    .flatMap((p) =>
      p.updates.map((u) => ({ ...u, projectName: p.name }))
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 6);

  return (
    <div className="space-y-5">
      {/* Greeting */}
      <div>
        <h2 className="text-2xl font-semibold">
          {greeting}, {displayName}
        </h2>
        <p className="mt-0.5 text-sm text-hub-muted">{dateLine}</p>
      </div>

      {/* Ask the assistant */}
      <div className="card p-4">
        <button
          onClick={() => onNavigate("chat")}
          className="flex w-full items-center gap-3 rounded-xl border border-hub-border bg-hub-bg/60 px-3.5 py-3 text-left text-sm text-hub-muted transition-colors hover:border-hub-accent"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-hub-accent to-hub-accent2 text-sm text-white">
            ✦
          </span>
          Ask your hub anything…
        </button>
        {aiEnabled && (
          <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => onAsk(s)}
                className="shrink-0 whitespace-nowrap rounded-full border border-hub-border bg-hub-panel2 px-3.5 py-2 text-xs text-slate-300 transition-colors hover:border-hub-accent"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2.5">
        <StatTile
          value={projects.length}
          label="Projects"
          onClick={() => onNavigate("projects")}
        />
        <StatTile
          value={activeCount}
          label="Active"
          accent
          onClick={() => onNavigate("projects")}
        />
        <StatTile
          value={bookmarks.length}
          label="Bookmarks"
          onClick={() => onNavigate("bookmarks")}
        />
      </div>

      {/* In motion */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-hub-muted">
            In motion
          </h3>
          <button
            onClick={() => onNavigate("projects")}
            className="p-1 text-xs text-hub-accent"
          >
            See all →
          </button>
        </div>
        {focus.length === 0 ? (
          <button
            onClick={() => onNavigate("projects")}
            className="card w-full p-6 text-center text-sm text-hub-muted"
          >
            Nothing in motion yet. Tap to add your first project →
          </button>
        ) : (
          <div className="card divide-y divide-hub-border/60">
            {focus.map((p) => {
              const meta = STATUS_META[p.status];
              const latest = p.updates[0];
              return (
                <button
                  key={p.id}
                  onClick={() => onNavigate("projects")}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-hub-panel2"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {p.pinned && (
                        <span className="text-xs text-amber-400">★</span>
                      )}
                      <span className="truncate font-medium">{p.name}</span>
                    </span>
                    <span className="block truncate text-xs text-hub-muted">
                      {latest
                        ? `${latest.body} · ${timeAgo(latest.createdAt)}`
                        : `${meta.label} · updated ${timeAgo(p.updatedAt)}`}
                    </span>
                  </span>
                  <span className="text-hub-muted">›</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent updates */}
      {recent.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-hub-muted">
            Recent updates
          </h3>
          <div className="card space-y-3 p-4">
            {recent.map((u) => (
              <div key={u.id} className="border-l-2 border-hub-border pl-3">
                <p className="text-sm text-slate-200">{u.body}</p>
                <p className="mt-0.5 text-xs text-hub-muted">
                  {u.projectName} · {timeAgo(u.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatTile({
  value,
  label,
  accent,
  onClick,
}: {
  value: number;
  label: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="card p-3 text-center transition-colors active:bg-hub-panel2"
    >
      <div
        className={`text-2xl font-semibold ${accent ? "text-hub-accent" : ""}`}
      >
        {value}
      </div>
      <div className="text-xs text-hub-muted">{label}</div>
    </button>
  );
}
