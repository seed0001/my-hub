import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.memory.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.memory.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
