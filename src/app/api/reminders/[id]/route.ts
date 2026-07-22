import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.reminder.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (["DONE", "DISMISSED", "PENDING"].includes(body.status)) data.status = body.status;

  if (typeof body.minutesFromNow === "number" && isFinite(body.minutesFromNow)) {
    data.dueAt = new Date(Date.now() + body.minutesFromNow * 60_000);
    data.status = "PENDING";
  } else if (body.dueAt) {
    const d = new Date(String(body.dueAt));
    if (!isNaN(d.getTime())) {
      data.dueAt = d;
      data.status = "PENDING";
    }
  }

  const reminder = await prisma.reminder.update({
    where: { id: existing.id },
    data,
    include: { project: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ reminder });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.reminder.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.reminder.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
