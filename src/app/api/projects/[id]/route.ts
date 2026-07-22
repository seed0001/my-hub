import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

const STATUSES = [
  "IDEA",
  "PLANNING",
  "ACTIVE",
  "PAUSED",
  "DONE",
  "ARCHIVED",
] as const;

async function ownedProject(userId: string, id: string) {
  return prisma.project.findFirst({ where: { id, userId } });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await ownedProject(session.userId, id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if ("description" in body) data.description = body.description ? String(body.description) : null;
  if (body.status && STATUSES.includes(body.status)) data.status = body.status;
  if ("url" in body) data.url = body.url ? String(body.url) : null;
  if ("repoUrl" in body) data.repoUrl = body.repoUrl ? String(body.repoUrl) : null;
  if ("color" in body) data.color = body.color ? String(body.color) : null;
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;

  const project = await prisma.project.update({
    where: { id },
    data,
    include: { updates: { orderBy: { createdAt: "desc" }, take: 5 } },
  });

  return NextResponse.json({ project });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await ownedProject(session.userId, id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
