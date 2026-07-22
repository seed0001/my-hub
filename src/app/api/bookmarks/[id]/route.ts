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
  const existing = await prisma.bookmark.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if ("note" in body) data.note = body.note ? String(body.note) : null;
  if ("category" in body) data.category = body.category ? String(body.category).trim() : null;
  if (Array.isArray(body.tags)) {
    data.tags = body.tags.map((t: unknown) => String(t).trim()).filter(Boolean);
  }

  const bookmark = await prisma.bookmark.update({ where: { id }, data });
  return NextResponse.json({ bookmark });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.bookmark.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.bookmark.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
