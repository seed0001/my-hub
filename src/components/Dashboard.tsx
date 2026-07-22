"use client";

import { useState } from "react";
import type { ProjectDTO, BookmarkDTO, ChatMessageDTO } from "@/lib/types";
import Projects from "@/components/Projects";
import Bookmarks from "@/components/Bookmarks";
import ChatPanel from "@/components/ChatPanel";

type Tab = "projects" | "bookmarks";

export default function Dashboard({
  userName,
  userEmail,
  aiEnabled,
  initialProjects,
  initialBookmarks,
  initialMessages,
}: {
  userName: string | null;
  userEmail: string;
  aiEnabled: boolean;
  initialProjects: ProjectDTO[];
  initialBookmarks: BookmarkDTO[];
  initialMessages: ChatMessageDTO[];
}) {
  const [tab, setTab] = useState<Tab>("projects");
  const [projects, setProjects] = useState(initialProjects);
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [chatOpen, setChatOpen] = useState(false);

  const displayName = userName || userEmail.split("@")[0];

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const activeCount = projects.filter(
    (p) => p.status === "ACTIVE" || p.status === "PLANNING"
  ).length;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col lg:flex-row">
      {/* Main column */}
      <div className="flex-1 px-4 py-6 sm:px-8">
        {/* Header */}
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-hub-accent to-hub-accent2 text-lg font-bold text-white shadow-lg">
              H
            </div>
            <div>
              <h1 className="text-xl font-semibold leading-tight">
                Welcome back, {displayName}
              </h1>
              <p className="text-sm text-hub-muted">
                {projects.length} projects · {activeCount} in motion ·{" "}
                {bookmarks.length} bookmarks
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChatOpen((v) => !v)}
              className="btn-ghost lg:hidden"
            >
              {chatOpen ? "Close AI" : "Ask AI"}
            </button>
            <button onClick={logout} className="btn-ghost">
              Sign out
            </button>
          </div>
        </header>

        {/* Tabs */}
        <div className="mb-6 inline-flex rounded-xl border border-hub-border bg-hub-panel p-1">
          <button
            onClick={() => setTab("projects")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === "projects"
                ? "bg-hub-accent text-white"
                : "text-hub-muted hover:text-white"
            }`}
          >
            Projects
          </button>
          <button
            onClick={() => setTab("bookmarks")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === "bookmarks"
                ? "bg-hub-accent text-white"
                : "text-hub-muted hover:text-white"
            }`}
          >
            Bookmarks
          </button>
        </div>

        {tab === "projects" ? (
          <Projects projects={projects} setProjects={setProjects} />
        ) : (
          <Bookmarks bookmarks={bookmarks} setBookmarks={setBookmarks} />
        )}
      </div>

      {/* Chat sidebar */}
      <aside
        className={`${
          chatOpen ? "block" : "hidden"
        } border-t border-hub-border lg:block lg:w-[400px] lg:border-l lg:border-t-0`}
      >
        <div className="lg:sticky lg:top-0 lg:h-screen">
          <ChatPanel aiEnabled={aiEnabled} initialMessages={initialMessages} />
        </div>
      </aside>
    </div>
  );
}
