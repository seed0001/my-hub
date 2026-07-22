import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Dashboard from "@/components/Dashboard";
import type { ProjectDTO, BookmarkDTO, ChatMessageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [user, projects, bookmarks, messages] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.userId } }),
    prisma.project.findMany({
      where: { userId: session.userId },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      include: { updates: { orderBy: { createdAt: "desc" }, take: 5 } },
    }),
    prisma.bookmark.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.chatMessage.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
  ]);

  const aiEnabled = Boolean(process.env.OPENROUTER_API_KEY);

  // Serialize dates for the client.
  const projectDTOs: ProjectDTO[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    url: p.url,
    repoUrl: p.repoUrl,
    color: p.color,
    pinned: p.pinned,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    updates: p.updates.map((u) => ({
      id: u.id,
      body: u.body,
      createdAt: u.createdAt.toISOString(),
    })),
  }));

  const bookmarkDTOs: BookmarkDTO[] = bookmarks.map((b) => ({
    id: b.id,
    title: b.title,
    url: b.url,
    note: b.note,
    category: b.category,
    tags: b.tags,
    favicon: b.favicon,
    createdAt: b.createdAt.toISOString(),
  }));

  const messageDTOs: ChatMessageDTO[] = messages.map((m) => ({
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <Dashboard
      userName={user?.name || null}
      userEmail={session.email}
      aiEnabled={aiEnabled}
      initialProjects={projectDTOs}
      initialBookmarks={bookmarkDTOs}
      initialMessages={messageDTOs}
    />
  );
}
