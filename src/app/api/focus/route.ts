import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { nextUpProject } from "@/lib/agentTools";

/** GET → active focus session (if still running) + round-robin next-up project. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const active = await prisma.focusSession.findFirst({
    where: { userId: session.userId, endedAt: null },
    include: { project: { select: { id: true, name: true } } },
    orderBy: { startedAt: "desc" },
  });

  const stillRunning =
    active && active.startedAt.getTime() + active.minutes * 60_000 > Date.now();

  // A session whose timer lapsed while nobody was looking gets closed out.
  if (active && !stillRunning) {
    await prisma.focusSession.update({
      where: { id: active.id },
      data: {
        endedAt: new Date(active.startedAt.getTime() + active.minutes * 60_000),
      },
    });
  }

  const next = await nextUpProject(
    session.userId,
    stillRunning ? active.projectId : undefined
  );

  return NextResponse.json({
    session: stillRunning ? active : null,
    nextUp: next ? { id: next.id, name: next.name } : null,
  });
}

/** POST {projectId, minutes} → start a focus block + schedule its "time's up" reminder. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const projectId = String(body.projectId || "");
  const minutes = Number(body.minutes);

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.userId },
  });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (!isFinite(minutes) || minutes < 1 || minutes > 480)
    return NextResponse.json(
      { error: "Minutes must be between 1 and 480." },
      { status: 400 }
    );

  await prisma.focusSession.updateMany({
    where: { userId: session.userId, endedAt: null },
    data: { endedAt: new Date() },
  });

  const focusSession = await prisma.focusSession.create({
    data: { userId: session.userId, projectId: project.id, minutes },
    include: { project: { select: { id: true, name: true } } },
  });

  const next = await nextUpProject(session.userId, project.id);
  await prisma.reminder.create({
    data: {
      userId: session.userId,
      title: `Time's up: ${project.name}`,
      body: next
        ? `Focus block done. Next up in your rotation: ${next.name}.`
        : "Focus block done. Nice work!",
      dueAt: new Date(Date.now() + minutes * 60_000),
      projectId: project.id,
    },
  });

  return NextResponse.json({
    session: focusSession,
    nextUp: next ? { id: next.id, name: next.name } : null,
  });
}

/** PATCH → end the current focus session early (also clears its pending reminder). */
export async function PATCH() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const active = await prisma.focusSession.findFirst({
    where: { userId: session.userId, endedAt: null },
    include: { project: true },
    orderBy: { startedAt: "desc" },
  });
  if (active) {
    await prisma.focusSession.update({
      where: { id: active.id },
      data: { endedAt: new Date() },
    });
    // Drop the not-yet-fired "time's up" reminder for this session.
    await prisma.reminder.deleteMany({
      where: {
        userId: session.userId,
        projectId: active.projectId,
        status: "PENDING",
        title: { startsWith: "Time's up:" },
      },
    });
  }

  const next = await nextUpProject(session.userId);
  return NextResponse.json({
    ok: true,
    nextUp: next ? { id: next.id, name: next.name } : null,
  });
}
