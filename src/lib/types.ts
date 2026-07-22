export type ProjectStatus =
  | "IDEA"
  | "PLANNING"
  | "ACTIVE"
  | "PAUSED"
  | "DONE"
  | "ARCHIVED";

export interface ProjectUpdateDTO {
  id: string;
  body: string;
  createdAt: string;
}

export interface ProjectDTO {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  url: string | null;
  repoUrl: string | null;
  color: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  updates: ProjectUpdateDTO[];
}

export interface BookmarkDTO {
  id: string;
  title: string;
  url: string;
  note: string | null;
  category: string | null;
  tags: string[];
  favicon: string | null;
  createdAt: string;
}

export interface ChatMessageDTO {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export type ArtifactKind = "roadmap" | "spec" | "note" | "doc" | "prompt";

export interface ArtifactDTO {
  id: string;
  num: number;
  title: string;
  kind: string;
  content: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderDTO {
  id: string;
  title: string;
  body: string | null;
  dueAt: string;
  status: string; // PENDING | SENT | DONE | DISMISSED
  projectId: string | null;
  project: { id: string; name: string } | null;
  createdAt: string;
}

export interface FocusSessionDTO {
  id: string;
  projectId: string;
  project: { id: string; name: string };
  minutes: number;
  startedAt: string;
  endedAt: string | null;
}

export const ARTIFACT_KIND_META: Record<string, { label: string; badge: string }> = {
  roadmap: { label: "Roadmap", badge: "text-emerald-300 border-emerald-700" },
  spec: { label: "Spec", badge: "text-sky-300 border-sky-700" },
  note: { label: "Note", badge: "text-amber-300 border-amber-700" },
  doc: { label: "Doc", badge: "text-slate-300 border-slate-600" },
  prompt: { label: "Build Prompt", badge: "text-violet-300 border-violet-700" },
};

export const STATUS_META: Record<
  ProjectStatus,
  { label: string; dot: string; badge: string }
> = {
  IDEA: { label: "Idea", dot: "bg-slate-400", badge: "text-slate-300 border-slate-600" },
  PLANNING: { label: "Planning", dot: "bg-sky-400", badge: "text-sky-300 border-sky-700" },
  ACTIVE: { label: "Active", dot: "bg-emerald-400", badge: "text-emerald-300 border-emerald-700" },
  PAUSED: { label: "Paused", dot: "bg-amber-400", badge: "text-amber-300 border-amber-700" },
  DONE: { label: "Done", dot: "bg-indigo-400", badge: "text-indigo-300 border-indigo-700" },
  ARCHIVED: { label: "Archived", dot: "bg-slate-600", badge: "text-slate-400 border-slate-700" },
};

export const STATUS_ORDER: ProjectStatus[] = [
  "IDEA",
  "PLANNING",
  "ACTIVE",
  "PAUSED",
  "DONE",
  "ARCHIVED",
];
