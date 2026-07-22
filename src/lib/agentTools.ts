import { prisma } from "@/lib/db";

/**
 * The assistant's hands: tool definitions (OpenAI function-calling format)
 * plus an executor that performs them against the database, always scoped
 * to the signed-in user.
 */

export type RefreshScope =
  | "projects"
  | "bookmarks"
  | "artifacts"
  | "reminders"
  | "focus";

export interface ToolOutcome {
  /** Compact JSON-safe payload returned to the model. */
  result: unknown;
  /** Human-readable action chip shown in the chat UI. */
  label?: string;
  /** Client data scopes to refetch after this tool ran. */
  refresh?: RefreshScope[];
}

const STATUSES = [
  "IDEA",
  "PLANNING",
  "ACTIVE",
  "PAUSED",
  "DONE",
  "ARCHIVED",
] as const;

const ARTIFACT_KINDS = ["roadmap", "spec", "note", "doc"] as const;

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function faviconFor(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return null;
  }
}

/**
 * Round-robin: among in-motion projects, pick the one whose most recent
 * focus session is oldest (never-focused projects come first).
 */
export async function nextUpProject(userId: string, excludeId?: string) {
  const projects = await prisma.project.findMany({
    where: {
      userId,
      status: { in: ["ACTIVE", "PLANNING"] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (projects.length === 0) return null;

  const latest = await prisma.focusSession.groupBy({
    by: ["projectId"],
    where: { userId },
    _max: { startedAt: true },
  });
  const lastFocused = new Map(
    latest.map((l) => [l.projectId, l._max.startedAt?.getTime() ?? 0])
  );
  projects.sort(
    (a, b) => (lastFocused.get(a.id) ?? 0) - (lastFocused.get(b.id) ?? 0)
  );
  return projects[0];
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "create_project",
      description:
        "Create a new project in the user's hub. Returns the created project with its id.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name" },
          description: { type: "string" },
          status: { type: "string", enum: [...STATUSES] },
          url: { type: "string", description: "Live site URL" },
          repoUrl: { type: "string", description: "Repository URL" },
          pinned: { type: "boolean" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_project",
      description:
        "Update fields on an existing project (status, name, description, links, pinned). Only pass fields you want to change.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: [...STATUSES] },
          url: { type: "string" },
          repoUrl: { type: "string" },
          pinned: { type: "boolean" },
        },
        required: ["projectId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_project",
      description:
        "Permanently delete a project and its updates. Confirm with the user before calling this.",
      parameters: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_project_update",
      description: "Post a status update to a project's feed.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          body: { type: "string", description: "The update text" },
        },
        required: ["projectId", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_bookmark",
      description: "Save a web address to the user's bookmarks.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          note: { type: "string" },
          category: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_bookmark",
      description: "Update a bookmark's title, note, category, or tags.",
      parameters: {
        type: "object",
        properties: {
          bookmarkId: { type: "string" },
          title: { type: "string" },
          note: { type: "string" },
          category: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["bookmarkId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_bookmark",
      description: "Delete a bookmark. Confirm with the user before calling this.",
      parameters: {
        type: "object",
        properties: { bookmarkId: { type: "string" } },
        required: ["bookmarkId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_artifact",
      description:
        "Create a document (artifact) in the catalog: a roadmap, spec, or note in markdown. Use for structured deliverables like project roadmaps with phases, milestones, and checkbox tasks. Returns the artifact number (e.g. 12 → shown as A-12).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          kind: { type: "string", enum: [...ARTIFACT_KINDS] },
          content: { type: "string", description: "Full markdown content" },
          projectId: {
            type: "string",
            description: "Optional project to attach this artifact to",
          },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_artifact",
      description: "Read the full current content of an artifact by its number.",
      parameters: {
        type: "object",
        properties: { artifactNum: { type: "integer" } },
        required: ["artifactNum"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_artifact",
      description:
        "Fine-tune an existing artifact WITHOUT rewriting it. Provide targeted find/replace edits (each `find` must match the artifact text exactly, and is replaced once), and/or text to append. Read the artifact first if you aren't sure of its exact current text. Only use `content` to fully replace when the user asks for a rewrite.",
      parameters: {
        type: "object",
        properties: {
          artifactNum: { type: "integer" },
          title: { type: "string", description: "New title" },
          kind: { type: "string", enum: [...ARTIFACT_KINDS] },
          projectId: { type: "string", description: "Attach to a project" },
          edits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                find: { type: "string", description: "Exact text to find" },
                replace: { type: "string", description: "Replacement text" },
              },
              required: ["find", "replace"],
            },
          },
          append: { type: "string", description: "Markdown to append at the end" },
          content: {
            type: "string",
            description: "Full replacement content (avoid; prefer edits)",
          },
        },
        required: ["artifactNum"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_artifact",
      description: "Delete an artifact. Confirm with the user before calling this.",
      parameters: {
        type: "object",
        properties: { artifactNum: { type: "integer" } },
        required: ["artifactNum"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_reminder",
      description:
        "Schedule a reminder/notification for the user. Provide either minutesFromNow or dueAt (ISO 8601 with timezone).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          minutesFromNow: { type: "number" },
          dueAt: { type: "string", description: "ISO 8601 datetime" },
          projectId: { type: "string" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_reminder",
      description:
        "Mark a reminder done/dismissed, or reschedule it with minutesFromNow or dueAt.",
      parameters: {
        type: "object",
        properties: {
          reminderId: { type: "string" },
          status: { type: "string", enum: ["DONE", "DISMISSED", "PENDING"] },
          minutesFromNow: { type: "number" },
          dueAt: { type: "string" },
        },
        required: ["reminderId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_focus_session",
      description:
        "Start a timed focus block on a project. Automatically schedules a reminder for when time is up, including which project is next in the round-robin rotation.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          minutes: { type: "number" },
        },
        required: ["projectId", "minutes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_focus_state",
      description:
        "Get the current focus session (if any) and the round-robin rotation order of in-motion projects.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : undefined);
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

function resolveDue(args: Args): Date | null {
  const mins = num(args.minutesFromNow);
  if (mins !== undefined) return new Date(Date.now() + mins * 60_000);
  const iso = str(args.dueAt);
  if (iso) {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export async function executeTool(
  userId: string,
  name: string,
  args: Args
): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "create_project": {
        const pname = str(args.name)?.trim();
        if (!pname) return { result: { error: "name is required" } };
        const status = STATUSES.includes(args.status as never)
          ? (args.status as (typeof STATUSES)[number])
          : "IDEA";
        const project = await prisma.project.create({
          data: {
            userId,
            name: pname,
            description: str(args.description) || null,
            status,
            url: str(args.url) || null,
            repoUrl: str(args.repoUrl) || null,
            pinned: bool(args.pinned) ?? false,
          },
        });
        return {
          result: { ok: true, projectId: project.id, name: project.name },
          label: `Created project “${project.name}”`,
          refresh: ["projects"],
        };
      }

      case "update_project": {
        const id = str(args.projectId);
        const existing = id
          ? await prisma.project.findFirst({ where: { id, userId } })
          : null;
        if (!existing) return { result: { error: "Project not found" } };
        const data: Record<string, unknown> = {};
        if (str(args.name)?.trim()) data.name = str(args.name)!.trim();
        if (args.description !== undefined)
          data.description = str(args.description) || null;
        if (STATUSES.includes(args.status as never)) data.status = args.status;
        if (args.url !== undefined) data.url = str(args.url) || null;
        if (args.repoUrl !== undefined) data.repoUrl = str(args.repoUrl) || null;
        if (bool(args.pinned) !== undefined) data.pinned = bool(args.pinned);
        const project = await prisma.project.update({
          where: { id: existing.id },
          data,
        });
        const changed = Object.keys(data).join(", ");
        return {
          result: { ok: true, projectId: project.id, changed },
          label: `Updated “${project.name}” (${changed})`,
          refresh: ["projects"],
        };
      }

      case "delete_project": {
        const id = str(args.projectId);
        const existing = id
          ? await prisma.project.findFirst({ where: { id, userId } })
          : null;
        if (!existing) return { result: { error: "Project not found" } };
        await prisma.project.delete({ where: { id: existing.id } });
        return {
          result: { ok: true },
          label: `Deleted project “${existing.name}”`,
          refresh: ["projects", "artifacts", "reminders"],
        };
      }

      case "add_project_update": {
        const id = str(args.projectId);
        const body = str(args.body)?.trim();
        const existing = id
          ? await prisma.project.findFirst({ where: { id, userId } })
          : null;
        if (!existing) return { result: { error: "Project not found" } };
        if (!body) return { result: { error: "body is required" } };
        await prisma.projectUpdate.create({
          data: { projectId: existing.id, body },
        });
        await prisma.project.update({
          where: { id: existing.id },
          data: { updatedAt: new Date() },
        });
        return {
          result: { ok: true },
          label: `Posted update to “${existing.name}”`,
          refresh: ["projects"],
        };
      }

      case "create_bookmark": {
        const rawUrl = str(args.url)?.trim();
        if (!rawUrl) return { result: { error: "url is required" } };
        const url = normalizeUrl(rawUrl);
        const title =
          str(args.title)?.trim() || url.replace(/^https?:\/\//, "");
        const tags = Array.isArray(args.tags)
          ? args.tags.map((t) => String(t).trim()).filter(Boolean)
          : [];
        const bookmark = await prisma.bookmark.create({
          data: {
            userId,
            url,
            title,
            note: str(args.note) || null,
            category: str(args.category)?.trim() || null,
            tags,
            favicon: faviconFor(url),
          },
        });
        return {
          result: { ok: true, bookmarkId: bookmark.id, title: bookmark.title },
          label: `Saved bookmark “${bookmark.title}”`,
          refresh: ["bookmarks"],
        };
      }

      case "update_bookmark": {
        const id = str(args.bookmarkId);
        const existing = id
          ? await prisma.bookmark.findFirst({ where: { id, userId } })
          : null;
        if (!existing) return { result: { error: "Bookmark not found" } };
        const data: Record<string, unknown> = {};
        if (str(args.title)?.trim()) data.title = str(args.title)!.trim();
        if (args.note !== undefined) data.note = str(args.note) || null;
        if (args.category !== undefined)
          data.category = str(args.category)?.trim() || null;
        if (Array.isArray(args.tags))
          data.tags = args.tags.map((t) => String(t).trim()).filter(Boolean);
        const bookmark = await prisma.bookmark.update({
          where: { id: existing.id },
          data,
        });
        return {
          result: { ok: true, bookmarkId: bookmark.id },
          label: `Updated bookmark “${bookmark.title}”`,
          refresh: ["bookmarks"],
        };
      }

      case "delete_bookmark": {
        const id = str(args.bookmarkId);
        const existing = id
          ? await prisma.bookmark.findFirst({ where: { id, userId } })
          : null;
        if (!existing) return { result: { error: "Bookmark not found" } };
        await prisma.bookmark.delete({ where: { id: existing.id } });
        return {
          result: { ok: true },
          label: `Deleted bookmark “${existing.title}”`,
          refresh: ["bookmarks"],
        };
      }

      case "create_artifact": {
        const title = str(args.title)?.trim();
        const content = str(args.content);
        if (!title || !content)
          return { result: { error: "title and content are required" } };
        const kind = ARTIFACT_KINDS.includes(args.kind as never)
          ? (args.kind as string)
          : "doc";
        const projectId = str(args.projectId);
        if (projectId) {
          const owns = await prisma.project.findFirst({
            where: { id: projectId, userId },
          });
          if (!owns) return { result: { error: "Project not found" } };
        }
        const artifact = await prisma.artifact.create({
          data: {
            userId,
            title,
            kind,
            content,
            projectId: projectId || null,
          },
        });
        return {
          result: { ok: true, artifactNum: artifact.num, title: artifact.title },
          label: `Created ${kind} A-${artifact.num}: “${artifact.title}”`,
          refresh: ["artifacts"],
        };
      }

      case "read_artifact": {
        const n = num(args.artifactNum);
        const artifact = n
          ? await prisma.artifact.findFirst({ where: { num: n, userId } })
          : null;
        if (!artifact) return { result: { error: "Artifact not found" } };
        return {
          result: {
            artifactNum: artifact.num,
            title: artifact.title,
            kind: artifact.kind,
            content: artifact.content,
          },
        };
      }

      case "edit_artifact": {
        const n = num(args.artifactNum);
        const artifact = n
          ? await prisma.artifact.findFirst({ where: { num: n, userId } })
          : null;
        if (!artifact) return { result: { error: "Artifact not found" } };

        let content = artifact.content;
        const failed: string[] = [];
        if (Array.isArray(args.edits)) {
          for (const e of args.edits) {
            const find = typeof e?.find === "string" ? e.find : null;
            const replace = typeof e?.replace === "string" ? e.replace : "";
            if (!find) continue;
            if (!content.includes(find)) {
              failed.push(find.slice(0, 80));
              continue;
            }
            content = content.replace(find, replace);
          }
        }
        if (str(args.content) !== undefined && str(args.content) !== "") {
          content = str(args.content)!;
        }
        if (str(args.append)) {
          content = content.trimEnd() + "\n\n" + str(args.append);
        }

        const data: Record<string, unknown> = { content };
        if (str(args.title)?.trim()) data.title = str(args.title)!.trim();
        if (ARTIFACT_KINDS.includes(args.kind as never)) data.kind = args.kind;
        const projectId = str(args.projectId);
        if (projectId) {
          const owns = await prisma.project.findFirst({
            where: { id: projectId, userId },
          });
          if (owns) data.projectId = projectId;
        }

        const updated = await prisma.artifact.update({
          where: { id: artifact.id },
          data,
        });
        return {
          result: {
            ok: failed.length === 0,
            artifactNum: updated.num,
            ...(failed.length
              ? {
                  warning: `These find strings didn't match and were skipped: ${failed.join(" | ")}. Read the artifact to see its exact text.`,
                }
              : {}),
          },
          label: `Edited A-${updated.num}: “${updated.title}”`,
          refresh: ["artifacts"],
        };
      }

      case "delete_artifact": {
        const n = num(args.artifactNum);
        const artifact = n
          ? await prisma.artifact.findFirst({ where: { num: n, userId } })
          : null;
        if (!artifact) return { result: { error: "Artifact not found" } };
        await prisma.artifact.delete({ where: { id: artifact.id } });
        return {
          result: { ok: true },
          label: `Deleted A-${artifact.num}: “${artifact.title}”`,
          refresh: ["artifacts"],
        };
      }

      case "create_reminder": {
        const title = str(args.title)?.trim();
        if (!title) return { result: { error: "title is required" } };
        const dueAt = resolveDue(args);
        if (!dueAt)
          return {
            result: { error: "Provide minutesFromNow or a valid dueAt (ISO 8601)" },
          };
        const projectId = str(args.projectId);
        if (projectId) {
          const owns = await prisma.project.findFirst({
            where: { id: projectId, userId },
          });
          if (!owns) return { result: { error: "Project not found" } };
        }
        const reminder = await prisma.reminder.create({
          data: {
            userId,
            title,
            body: str(args.body) || null,
            dueAt,
            projectId: projectId || null,
          },
        });
        return {
          result: {
            ok: true,
            reminderId: reminder.id,
            dueAt: reminder.dueAt.toISOString(),
          },
          label: `Set reminder “${reminder.title}” for ${reminder.dueAt.toISOString()}`,
          refresh: ["reminders"],
        };
      }

      case "update_reminder": {
        const id = str(args.reminderId);
        const existing = id
          ? await prisma.reminder.findFirst({ where: { id, userId } })
          : null;
        if (!existing) return { result: { error: "Reminder not found" } };
        const data: Record<string, unknown> = {};
        const status = str(args.status);
        if (status && ["DONE", "DISMISSED", "PENDING"].includes(status))
          data.status = status;
        const dueAt = resolveDue(args);
        if (dueAt) {
          data.dueAt = dueAt;
          data.status = "PENDING";
        }
        const reminder = await prisma.reminder.update({
          where: { id: existing.id },
          data,
        });
        return {
          result: { ok: true, reminderId: reminder.id, status: reminder.status },
          label:
            reminder.status === "PENDING"
              ? `Rescheduled “${reminder.title}”`
              : `Marked reminder “${reminder.title}” ${reminder.status.toLowerCase()}`,
          refresh: ["reminders"],
        };
      }

      case "start_focus_session": {
        const projectId = str(args.projectId);
        const minutes = num(args.minutes);
        const project = projectId
          ? await prisma.project.findFirst({ where: { id: projectId, userId } })
          : null;
        if (!project) return { result: { error: "Project not found" } };
        if (!minutes || minutes < 1 || minutes > 480)
          return { result: { error: "minutes must be between 1 and 480" } };

        // Close any session still open.
        await prisma.focusSession.updateMany({
          where: { userId, endedAt: null },
          data: { endedAt: new Date() },
        });

        const session = await prisma.focusSession.create({
          data: { userId, projectId: project.id, minutes },
        });
        const next = await nextUpProject(userId, project.id);
        await prisma.reminder.create({
          data: {
            userId,
            title: `Time's up: ${project.name}`,
            body: next
              ? `Focus block done. Next up in your rotation: ${next.name}.`
              : "Focus block done. Nice work!",
            dueAt: new Date(Date.now() + minutes * 60_000),
            projectId: project.id,
          },
        });
        return {
          result: {
            ok: true,
            sessionId: session.id,
            project: project.name,
            minutes,
            nextUp: next?.name ?? null,
          },
          label: `Started ${minutes}m focus on “${project.name}”${next ? ` — next up: ${next.name}` : ""}`,
          refresh: ["focus", "reminders"],
        };
      }

      case "get_focus_state": {
        const active = await prisma.focusSession.findFirst({
          where: { userId, endedAt: null },
          include: { project: true },
          orderBy: { startedAt: "desc" },
        });
        const activeInfo =
          active &&
          active.startedAt.getTime() + active.minutes * 60_000 > Date.now()
            ? {
                project: active.project.name,
                projectId: active.projectId,
                minutes: active.minutes,
                startedAt: active.startedAt.toISOString(),
                minutesRemaining: Math.max(
                  0,
                  Math.round(
                    (active.startedAt.getTime() +
                      active.minutes * 60_000 -
                      Date.now()) /
                      60_000
                  )
                ),
              }
            : null;
        const next = await nextUpProject(userId, activeInfo?.projectId);
        return {
          result: {
            activeSession: activeInfo,
            nextUp: next ? { projectId: next.id, name: next.name } : null,
          },
        };
      }

      default:
        return { result: { error: `Unknown tool: ${name}` } };
    }
  } catch (err) {
    console.error(`tool ${name} failed`, err);
    return { result: { error: "Tool execution failed unexpectedly." } };
  }
}
