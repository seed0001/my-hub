import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { streamChat, type ChatMessageInput } from "@/lib/openrouter";

export const runtime = "nodejs";
export const maxDuration = 60;

const STATUS_LABEL: Record<string, string> = {
  IDEA: "Idea",
  PLANNING: "Planning",
  ACTIVE: "Active",
  PAUSED: "Paused",
  DONE: "Done",
  ARCHIVED: "Archived",
};

/** Build a system prompt that gives the assistant awareness of the user's hub. */
async function buildContext(userId: string, userEmail: string): Promise<string> {
  const [user, projects, bookmarks] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: { updates: { orderBy: { createdAt: "desc" }, take: 3 } },
    }),
    prisma.bookmark.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
  ]);

  const name = user?.name || userEmail;

  const projectLines = projects.length
    ? projects
        .map((p) => {
          const updates = p.updates.length
            ? " Recent updates: " +
              p.updates.map((u) => `“${u.body}”`).join("; ")
            : "";
          const links = [p.url && `site: ${p.url}`, p.repoUrl && `repo: ${p.repoUrl}`]
            .filter(Boolean)
            .join(", ");
          return `- ${p.name} [${STATUS_LABEL[p.status] || p.status}]${
            p.description ? ` — ${p.description}` : ""
          }${links ? ` (${links})` : ""}.${updates}`;
        })
        .join("\n")
    : "  (no projects yet)";

  const bookmarkLines = bookmarks.length
    ? bookmarks
        .map(
          (b) =>
            `- ${b.title} — ${b.url}${b.category ? ` [${b.category}]` : ""}${
              b.tags.length ? ` #${b.tags.join(" #")}` : ""
            }`
        )
        .join("\n")
    : "  (no bookmarks yet)";

  return [
    `You are the built-in AI assistant for "my-hub", ${name}'s personal command center.`,
    `You help ${name} manage projects, keep track of status, organize bookmarks, and think through ideas.`,
    `Be concise, friendly, and practical. Use the context below to give specific, grounded answers. If asked to add or change something you cannot directly modify, tell the user exactly which button/section to use.`,
    ``,
    `=== ${name}'s PROJECTS ===`,
    projectLines,
    ``,
    `=== ${name}'s BOOKMARKS ===`,
    bookmarkLines,
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

  const { message } = await req.json();
  const text = String(message || "").trim();
  if (!text) return NextResponse.json({ error: "Message is required." }, { status: 400 });

  // Persist the user's message.
  await prisma.chatMessage.create({
    data: { userId: session.userId, role: "user", content: text },
  });

  // Pull recent history (post-insert so it includes this message).
  const history = await prisma.chatMessage.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "asc" },
    take: 30,
  });

  const system = await buildContext(session.userId, session.email);

  const messages: ChatMessageInput[] = [
    { role: "system", content: system },
    ...history.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
  ];

  let upstream: Response;
  try {
    upstream = await streamChat(messages);
  } catch (err) {
    console.error("openrouter error", err);
    return NextResponse.json({ error: "Failed to reach the AI provider." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("openrouter bad response", upstream.status, detail);
    return NextResponse.json(
      { error: `AI provider error (${upstream.status}).` },
      { status: 502 }
    );
  }

  const userId = session.userId;

  // Transform OpenRouter SSE -> plain text tokens, accumulate, persist at the end.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      let full = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                full += delta;
                controller.enqueue(encoder.encode(delta));
              }
            } catch {
              // Ignore keep-alive comments / partial fragments.
            }
          }
        }
      } catch (err) {
        console.error("stream error", err);
      } finally {
        controller.close();
        if (full.trim()) {
          await prisma.chatMessage
            .create({
              data: { userId, role: "assistant", content: full },
            })
            .catch((e) => console.error("persist assistant msg failed", e));
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
