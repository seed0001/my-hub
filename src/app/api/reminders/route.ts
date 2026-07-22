import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * GET /api/reminders          → open reminders (pending + recently fired)
 * GET /api/reminders?due=1    → atomically claim due PENDING reminders
 *                               (marks them SENT and returns them once, so
 *                               the client can notify without duplicates)
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const due = req.nextUrl.searchParams.get("due");
  if (due) {
    const now = new Date();
    const dueReminders = await prisma.reminder.findMany({
      where: { userId: session.userId, status: "PENDING", dueAt: { lte: now } },
      orderBy: { dueAt: "asc" },
    });
    if (dueReminders.length) {
      await prisma.reminder.updateMany({
        where: { id: { in: dueReminders.map((r) => r.id) } },
        data: { status: "SENT" },
      });
    }
    return NextResponse.json({ reminders: dueReminders });
  }

  const reminders = await prisma.reminder.findMany({
    where: { userId: session.userId, status: { in: ["PENDING", "SENT"] } },
    orderBy: { dueAt: "asc" },
    take: 50,
    include: { project: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ reminders });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const title = String(body.title || "").trim();
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  let dueAt: Date | null = null;
  if (typeof body.minutesFromNow === "number" && isFinite(body.minutesFromNow)) {
    dueAt = new Date(Date.now() + body.minutesFromNow * 60_000);
  } else if (body.dueAt) {
    const d = new Date(String(body.dueAt));
    if (!isNaN(d.getTime())) dueAt = d;
  }
  if (!dueAt)
    return NextResponse.json(
      { error: "Provide minutesFromNow or a valid dueAt." },
      { status: 400 }
    );

  const projectId = body.projectId ? String(body.projectId) : null;
  if (projectId) {
    const owns = await prisma.project.findFirst({
      where: { id: projectId, userId: session.userId },
    });
    if (!owns) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const reminder = await prisma.reminder.create({
    data: {
      userId: session.userId,
      title,
      body: body.body ? String(body.body) : null,
      dueAt,
      projectId,
    },
    include: { project: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ reminder });
}
