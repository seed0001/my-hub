"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  BookmarkDTO,
  ProjectDTO,
  ReminderDTO,
  FocusSessionDTO,
} from "@/lib/types";
import { STATUS_META } from "@/lib/types";
import { timeAgo } from "@/lib/time";
import { enablePush } from "@/lib/pushClient";

const SUGGESTIONS = [
  "What should I focus on today?",
  "Turn my latest idea into a roadmap",
  "Summarize where all my projects stand",
];

const DURATIONS = [15, 25, 45, 60];

function dueIn(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const m = Math.round(diff / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
  return `in ${Math.round(h / 24)}d`;
}

export default function Today({
  displayName,
  aiEnabled,
  projects,
  bookmarks,
  reminders,
  setReminders,
  focusTick,
  onAsk,
  onNavigate,
}: {
  displayName: string;
  aiEnabled: boolean;
  projects: ProjectDTO[];
  bookmarks: BookmarkDTO[];
  reminders: ReminderDTO[];
  setReminders: React.Dispatch<React.SetStateAction<ReminderDTO[]>>;
  focusTick: number;
  onAsk: (prompt: string) => void;
  onNavigate: (tab: "chat" | "projects" | "docs" | "bookmarks") => void;
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

  const focus = [
    ...projects.filter((p) => p.pinned),
    ...projects.filter(
      (p) => !p.pinned && (p.status === "ACTIVE" || p.status === "PLANNING")
    ),
  ].slice(0, 5);

  const upcoming = reminders
    .filter((r) => r.status === "PENDING" || r.status === "SENT")
    .slice(0, 5);

  async function resolveReminder(r: ReminderDTO, status: "DONE" | "DISMISSED") {
    setReminders((prev) => prev.filter((x) => x.id !== r.id));
    await fetch(`/api/reminders/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

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

      {/* Focus session */}
      <FocusCard projects={projects} focusTick={focusTick} />

      {/* Reminders */}
      {upcoming.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-hub-muted">
            Reminders
          </h3>
          <div className="card divide-y divide-hub-border/60">
            {upcoming.map((r) => {
              const overdue = new Date(r.dueAt).getTime() <= Date.now();
              return (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-base">⏰</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-hub-muted">
                      {r.project ? `${r.project.name} · ` : ""}
                      <span className={overdue ? "text-amber-300" : ""}>
                        {overdue ? "due now" : dueIn(r.dueAt)}
                      </span>
                    </p>
                  </div>
                  <button
                    onClick={() => resolveReminder(r, "DONE")}
                    className="rounded-md px-2 py-1.5 text-xs font-medium text-emerald-300"
                  >
                    Done
                  </button>
                  <button
                    onClick={() => resolveReminder(r, "DISMISSED")}
                    className="rounded-md px-2 py-1.5 text-xs text-hub-muted"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

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

      <NotificationsNudge />
    </div>
  );
}

// ---------------------------------------------------------------------------

function FocusCard({
  projects,
  focusTick,
}: {
  projects: ProjectDTO[];
  focusTick: number;
}) {
  const [session, setSession] = useState<FocusSessionDTO | null>(null);
  const [nextUp, setNextUp] = useState<{ id: string; name: string } | null>(null);
  const [pickProject, setPickProject] = useState<string>("");
  const [pickMinutes, setPickMinutes] = useState(25);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/focus");
      if (!res.ok) return;
      const data = await res.json();
      setSession(data.session);
      setNextUp(data.nextUp);
      if (data.nextUp && !data.session) setPickProject(data.nextUp.id);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, focusTick]);

  // Tick the countdown.
  useEffect(() => {
    if (!session) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [session]);

  const inMotion = projects.filter(
    (p) => p.status === "ACTIVE" || p.status === "PLANNING"
  );

  async function start() {
    const projectId = pickProject || inMotion[0]?.id;
    if (!projectId || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, minutes: pickMinutes }),
      });
      if (res.ok) {
        const data = await res.json();
        setSession(data.session);
        setNextUp(data.nextUp);
      }
    } finally {
      setBusy(false);
    }
  }

  async function endEarly() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/focus", { method: "PATCH" });
      if (res.ok) {
        const data = await res.json();
        setSession(null);
        setNextUp(data.nextUp);
        if (data.nextUp) setPickProject(data.nextUp.id);
      }
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    const end =
      new Date(session.startedAt).getTime() + session.minutes * 60_000;
    const remaining = Math.max(0, end - now);
    const mm = Math.floor(remaining / 60_000);
    const ss = Math.floor((remaining % 60_000) / 1000);
    const pct = Math.min(
      100,
      100 - (remaining / (session.minutes * 60_000)) * 100
    );

    return (
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-hub-accent">
              Focusing
            </p>
            <p className="truncate font-semibold">{session.project.name}</p>
          </div>
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {remaining === 0 ? "Done!" : `${mm}:${String(ss).padStart(2, "0")}`}
          </p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-hub-border/60">
          <div
            className="h-full rounded-full bg-gradient-to-r from-hub-accent to-hub-accent2 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-hub-muted">
            {nextUp ? `Next up: ${nextUp.name}` : "Last one in rotation"}
          </p>
          <button
            onClick={endEarly}
            disabled={busy}
            className="btn-ghost shrink-0 py-1.5 text-xs"
          >
            {remaining === 0 ? "Wrap up" : "End early"}
          </button>
        </div>
      </div>
    );
  }

  if (inMotion.length === 0) return null;

  return (
    <div className="card p-4">
      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-hub-muted">
        Start a focus block
      </p>
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
        {inMotion.map((p) => (
          <button
            key={p.id}
            onClick={() => setPickProject(p.id)}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              (pickProject || inMotion[0].id) === p.id
                ? "border-hub-accent bg-hub-accent/20 text-white"
                : "border-hub-border bg-hub-panel2 text-hub-muted"
            }`}
          >
            {nextUp?.id === p.id ? "▸ " : ""}
            {p.name}
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <div className="flex flex-1 gap-1.5">
          {DURATIONS.map((d) => (
            <button
              key={d}
              onClick={() => setPickMinutes(d)}
              className={`flex-1 rounded-lg border px-1 py-1.5 text-xs font-medium transition-colors ${
                pickMinutes === d
                  ? "border-hub-accent bg-hub-accent/20 text-white"
                  : "border-hub-border bg-hub-panel2 text-hub-muted"
              }`}
            >
              {d}m
            </button>
          ))}
        </div>
        <button
          onClick={start}
          disabled={busy}
          className="btn-primary shrink-0 py-1.5 text-sm"
        >
          Start
        </button>
      </div>
      {nextUp && (
        <p className="mt-2 text-xs text-hub-muted">
          ▸ marks the next project in your rotation
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function NotificationsNudge() {
  const [state, setState] = useState<"unsupported" | "default" | "granted" | "denied">(
    "unsupported"
  );

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setState(Notification.permission as "default" | "granted" | "denied");
    }
  }, []);

  if (state !== "default") return null;

  async function enable() {
    const perm = await Notification.requestPermission();
    setState(perm as "granted" | "denied");
    if (perm === "granted") {
      await enablePush();
    }
  }

  return (
    <button
      onClick={enable}
      className="card flex w-full items-center gap-3 p-3.5 text-left"
    >
      <span className="text-xl">🔔</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Enable notifications</span>
        <span className="block text-xs text-hub-muted">
          Get focus-timer and reminder alerts on this device
        </span>
      </span>
      <span className="text-hub-muted">›</span>
    </button>
  );
}

// ---------------------------------------------------------------------------

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
