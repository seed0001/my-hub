"use client";

import { useState } from "react";
import type { ProjectDTO, BookmarkDTO, ChatMessageDTO } from "@/lib/types";
import Projects from "@/components/Projects";
import Bookmarks from "@/components/Bookmarks";
import ChatPanel from "@/components/ChatPanel";
import Today from "@/components/Today";

type Tab = "today" | "chat" | "projects" | "bookmarks";

const TAB_TITLES: Record<Tab, string> = {
  today: "My Hub",
  chat: "Assistant",
  projects: "Projects",
  bookmarks: "Bookmarks",
};

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
  const [tab, setTab] = useState<Tab>("today");
  const [projects, setProjects] = useState(initialProjects);
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  const displayName = userName || userEmail.split("@")[0];

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function askAssistant(prompt: string) {
    setPendingPrompt(prompt);
    setTab("chat");
  }

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col sm:border-x sm:border-hub-border/60">
      {/* Top bar */}
      <header className="shrink-0 border-b border-hub-border/60 bg-hub-bg/80 pt-safe backdrop-blur">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-hub-accent to-hub-accent2 text-sm font-bold text-white">
              H
            </div>
            <h1 className="font-semibold">{TAB_TITLES[tab]}</h1>
          </div>
          <button
            onClick={logout}
            className="rounded-lg p-2 text-hub-muted transition-colors hover:bg-hub-border/50 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="min-h-0 flex-1">
        {/* Chat stays mounted so a streaming reply survives tab switches. */}
        <div className={tab === "chat" ? "h-full" : "hidden"}>
          <ChatPanel
            aiEnabled={aiEnabled}
            initialMessages={initialMessages}
            pendingPrompt={pendingPrompt}
            onPromptConsumed={() => setPendingPrompt(null)}
          />
        </div>
        {tab !== "chat" && (
          <div className="h-full overflow-y-auto overscroll-contain px-4 py-4">
            {tab === "today" && (
              <Today
                displayName={displayName}
                aiEnabled={aiEnabled}
                projects={projects}
                bookmarks={bookmarks}
                onAsk={askAssistant}
                onNavigate={setTab}
              />
            )}
            {tab === "projects" && (
              <Projects projects={projects} setProjects={setProjects} />
            )}
            {tab === "bookmarks" && (
              <Bookmarks bookmarks={bookmarks} setBookmarks={setBookmarks} />
            )}
          </div>
        )}
      </main>

      {/* Bottom tab bar */}
      <nav className="shrink-0 border-t border-hub-border bg-hub-panel/90 pb-safe backdrop-blur">
        <div className="grid grid-cols-4">
          <TabButton
            active={tab === "today"}
            label="Today"
            onClick={() => setTab("today")}
            icon={<SunIcon />}
          />
          <TabButton
            active={tab === "chat"}
            label="Assistant"
            onClick={() => setTab("chat")}
            icon={<SparkIcon />}
          />
          <TabButton
            active={tab === "projects"}
            label="Projects"
            onClick={() => setTab("projects")}
            icon={<FolderIcon />}
          />
          <TabButton
            active={tab === "bookmarks"}
            label="Bookmarks"
            onClick={() => setTab("bookmarks")}
            icon={<BookmarkIcon />}
          />
        </div>
      </nav>
    </div>
  );
}

function TabButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors ${
        active ? "text-white" : "text-hub-muted"
      }`}
    >
      <span className={active ? "text-hub-accent" : ""}>{icon}</span>
      {label}
    </button>
  );
}

const iconProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function SunIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg {...iconProps}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  );
}
