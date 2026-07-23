import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  streamChat,
  parseSSE,
  type ChatMessageInput,
} from "@/lib/openrouter";
import {
  TOOL_DEFS,
  executeTool,
  nextUpProject,
  type RefreshScope,
} from "@/lib/agentTools";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_TOOL_ROUNDS = 8;

const STATUS_LABEL: Record<string, string> = {
  IDEA: "Idea",
  PLANNING: "Planning",
  ACTIVE: "Active",
  PAUSED: "Paused",
  DONE: "Done",
  ARCHIVED: "Archived",
};

/** Build a system prompt with the hub's full state, including IDs the tools need. */
async function buildContext(
  userId: string,
  userEmail: string,
  timeZone: string | null
): Promise<string> {
  const [
    user,
    projects,
    bookmarks,
    artifacts,
    reminders,
    activeFocus,
    profile,
    memories,
  ] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.project.findMany({
        where: { userId },
        orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
        include: { updates: { orderBy: { createdAt: "desc" }, take: 3 } },
      }),
      prisma.bookmark.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
      prisma.artifact.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        select: {
          num: true,
          title: true,
          kind: true,
          updatedAt: true,
          project: { select: { name: true } },
        },
      }),
      prisma.reminder.findMany({
        where: { userId, status: { in: ["PENDING", "SENT"] } },
        orderBy: { dueAt: "asc" },
        take: 20,
      }),
      prisma.focusSession.findFirst({
        where: { userId, endedAt: null },
        include: { project: true },
        orderBy: { startedAt: "desc" },
      }),
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.memory.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 80,
      }),
    ]);

  const name = user?.name || userEmail;
  const tz = timeZone || "UTC";
  const nowLine = `Current time: ${new Date().toISOString()} (UTC). The user's timezone is ${tz} — interpret times they mention in that zone, and pass dueAt to tools as ISO 8601 with offset or UTC.`;

  const projectLines = projects.length
    ? projects
        .map((p) => {
          const updates = p.updates.length
            ? ` Recent: ` + p.updates.map((u) => `“${u.body}”`).join("; ")
            : "";
          const links = [p.url && `site: ${p.url}`, p.repoUrl && `repo: ${p.repoUrl}`]
            .filter(Boolean)
            .join(", ");
          return `- [id:${p.id}] ${p.name} [${STATUS_LABEL[p.status] || p.status}]${
            p.pinned ? " ★pinned" : ""
          }${p.description ? ` — ${p.description}` : ""}${links ? ` (${links})` : ""}.${updates}`;
        })
        .join("\n")
    : "(no projects yet)";

  const bookmarkLines = bookmarks.length
    ? bookmarks
        .map(
          (b) =>
            `- [id:${b.id}] ${b.title} — ${b.url}${b.category ? ` [${b.category}]` : ""}${
              b.tags.length ? ` #${b.tags.join(" #")}` : ""
            }`
        )
        .join("\n")
    : "(no bookmarks yet)";

  const artifactLines = artifacts.length
    ? artifacts
        .map(
          (a) =>
            `- A-${a.num} [${a.kind}] “${a.title}”${
              a.project ? ` (project: ${a.project.name})` : ""
            } — updated ${a.updatedAt.toISOString().slice(0, 10)}`
        )
        .join("\n")
    : "(no artifacts yet)";

  const reminderLines = reminders.length
    ? reminders
        .map(
          (r) =>
            `- [id:${r.id}] “${r.title}” due ${r.dueAt.toISOString()} [${r.status}]`
        )
        .join("\n")
    : "(no pending reminders)";

  let focusLine = "(no active focus session)";
  if (
    activeFocus &&
    activeFocus.startedAt.getTime() + activeFocus.minutes * 60_000 > Date.now()
  ) {
    const remaining = Math.round(
      (activeFocus.startedAt.getTime() +
        activeFocus.minutes * 60_000 -
        Date.now()) /
        60_000
    );
    focusLine = `Focusing on “${activeFocus.project.name}” — ${remaining} of ${activeFocus.minutes} minutes remaining.`;
  }
  const next = await nextUpProject(userId, activeFocus?.projectId);
  if (next) focusLine += ` Next up in rotation: ${next.name}.`;

  const memoryLines = memories.length
    ? memories
        .map((m) => `- [id:${m.id}] ${m.content}`)
        .join("\n")
    : "(nothing saved yet)";

  const profileContent = profile?.content?.trim()
    ? profile.content
    : "(empty — build this out as you learn about the user)";

  return [
    `You are the built-in AI assistant for "my-hub", ${name}'s personal command center, used mostly from a phone.`,
    `You are an AGENT with tools: you can create/update/delete projects and bookmarks, post project updates, create and edit documents (artifacts), schedule reminders, run timed focus sessions, search the web, and maintain long-term memory about ${name}. When ${name} asks for something actionable, DO IT with tools rather than describing how. Confirm before destructive deletes.`,
    ``,
    `Working style:`,
    `- YOUR ROLE IN THE BUILD PIPELINE: you are the planner and architect, NOT the builder. ${name} does all coding from their phone by handing prompts to a separate coding agent (Claude Code). You never write application code yourself. Your core deliverables are: (1) roadmap artifacts that structure an idea into phases/milestones with "- [ ]" tasks, and (2) BUILD PROMPT artifacts (kind "prompt") — the single most important thing you produce.`,
    `- A build prompt is a complete, self-contained instruction document ${name} copies and pastes to the coding agent. The coding agent cannot see this hub, so the prompt must stand alone. Structure each one with: **Objective** (what to build, one paragraph), **Context** (the project, its stack, relevant existing structure/URLs/repo), **Requirements** (detailed, numbered), **Constraints** (what NOT to touch, conventions to follow), and **Acceptance criteria** (how ${name} verifies it works). Write it as direct instructions to the coder ("Build...", "Add...", "The app uses...").`,
    `- Workflow: talk the idea through with ${name} first — ask what's unclear, propose scope — then create the roadmap, then generate build prompts one phase/feature at a time when ${name} is ready to build. Don't dump everything into one prompt.`,
    `- Iterate on artifacts with edit_artifact using targeted find/replace edits — do not rewrite whole documents for small changes. Artifacts are referenced as A-<num>. Read an artifact before editing it if you're unsure of its exact text.`,
    `- For time-boxed work use start_focus_session; it auto-schedules a "time's up" reminder that names the next project in the round-robin rotation, so ${name} touches every in-motion project through the day/week.`,
    `- MEMORY: silently maintain your knowledge of ${name} while you chat. When you learn a durable fact (where they live, what they like, hobbies, interests, tools they use, decisions, working habits), call save_memory (one short fact per call). Keep the USER PROFILE document current with update_profile — organize it with sections like About, Location, Work & projects, Interests & hobbies, Preferences & working style. Use targeted edits, not full rewrites. Correct or forget memories that turn out wrong. Don't announce that you're saving memories; just do it alongside your normal reply, and don't re-save things you already know.`,
    `- WEB: use web_search (DuckDuckGo) for anything needing current or external information — news, docs, prices, comparisons — then fetch_webpage to read the best results before answering. Cite the source URL briefly when you rely on it.`,
    `- GITHUB & RAILWAY: you have structured github_* and railway_* tools for managing ${name}'s GitHub repositories and Railway deployments (list/inspect, create repos, issues, PRs, releases, workflows, variables; Railway projects, services, deployments, logs, domains). Rules: (1) Default to read-only inspection; state exactly which repo/project/environment you're targeting before any write. (2) High-risk tools (deletes, visibility changes, collaborators, secrets, production changes, domains) return confirmationRequired with a summary and confirmationId — relay the summary, ask ${name} plainly, and only after an explicit yes in their NEXT message call the same tool again with identical arguments plus that confirmationId. Never treat earlier conversation as standing approval, and never invent a confirmationId. (3) NEVER ask for or accept secret values (tokens, passwords, API keys) in chat — chat history is stored. Send ${name} to the Integrations sheet (plug icon, top right) to enter secret values; you may create/delete non-secret variables and delete secrets by name. (4) On errors you get a structured category (e.g. NOT_AUTHENTICATED, CLI_NOT_INSTALLED, PERMISSION_DENIED) with a hint — explain it plainly and suggest the fix; include the correlationId if ${name} wants to check the audit log. (5) When creating a repository, visibility (public/private) and owner must be explicit — ask if unclear. Don't push code, add collaborators, create secrets, or deploy unless asked.`,
    `- Be concise and practical; this is a phone screen. After acting, summarize what you did in a sentence or two.`,
    ``,
    nowLine,
    ``,
    `=== USER PROFILE (maintained by you) ===`,
    profileContent,
    ``,
    `=== MEMORIES (most recent first) ===`,
    memoryLines,
    ``,
    `=== PROJECTS ===`,
    projectLines,
    ``,
    `=== BOOKMARKS ===`,
    bookmarkLines,
    ``,
    `=== ARTIFACT CATALOG ===`,
    artifactLines,
    ``,
    `=== REMINDERS ===`,
    reminderLines,
    ``,
    `=== FOCUS ===`,
    focusLine,
  ].join("\n");
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const messages = await prisma.chatMessage.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return NextResponse.json({ messages });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.chatMessage.deleteMany({ where: { userId: session.userId } });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "The AI assistant isn't configured yet (missing OPENROUTER_API_KEY)." },
      { status: 503 }
    );
  }

  const body = await req.json();
  const text = String(body.message || "").trim();
  const timeZone = body.timeZone ? String(body.timeZone) : null;
  if (!text) return NextResponse.json({ error: "Message is required." }, { status: 400 });

  await prisma.chatMessage.create({
    data: { userId: session.userId, role: "user", content: text },
  });

  const history = await prisma.chatMessage.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "asc" },
    take: 30,
  });

  const system = await buildContext(session.userId, session.email, timeZone);
  const userId = session.userId;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      const messages: ChatMessageInput[] = [
        { role: "system", content: system },
        ...history.map((m) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })),
      ];

      let fullText = "";
      const actionLabels: string[] = [];

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const upstream = await streamChat(messages, TOOL_DEFS);
          if (!upstream.ok || !upstream.body) {
            const detail = await upstream.text().catch(() => "");
            console.error("openrouter bad response", upstream.status, detail);
            emit({ t: "error", message: `AI provider error (${upstream.status}).` });
            break;
          }

          const { text: roundText, toolCalls } = await parseSSE(
            upstream,
            (delta) => {
              fullText += delta;
              emit({ t: "text", d: delta });
            }
          );

          if (toolCalls.length === 0) break;

          messages.push({
            role: "assistant",
            content: roundText || null,
            tool_calls: toolCalls,
          });

          const scopes = new Set<RefreshScope>();
          for (const tc of toolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function.arguments || "{}");
            } catch {
              // Model produced malformed JSON; the tool will report missing args.
            }
            const outcome = await executeTool(userId, tc.function.name, args);
            if (outcome.label) {
              actionLabels.push(outcome.label);
              emit({ t: "tool", name: tc.function.name, label: outcome.label });
            }
            outcome.refresh?.forEach((s) => scopes.add(s));
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(outcome.result),
            });
          }
          if (scopes.size) emit({ t: "refresh", scopes: [...scopes] });

          // Visual break between rounds when the model narrated mid-actions.
          if (roundText && !roundText.endsWith("\n")) {
            fullText += "\n\n";
            emit({ t: "text", d: "\n\n" });
          }
        }

        emit({ t: "done" });
      } catch (err) {
        console.error("agent loop error", err);
        emit({ t: "error", message: "Connection to the AI provider failed." });
      } finally {
        controller.close();
        const toSave = fullText.trim()
          ? fullText.trim()
          : actionLabels.length
            ? actionLabels.map((l) => `✓ ${l}`).join("\n")
            : "";
        if (toSave) {
          await prisma.chatMessage
            .create({ data: { userId, role: "assistant", content: toSave } })
            .catch((e) => console.error("persist assistant msg failed", e));
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
