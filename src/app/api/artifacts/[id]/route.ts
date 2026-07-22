import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

const KINDS = ["roadmap", "spec", "note", "doc"];

async function findOwned(id: string, userId: string) {
  return prisma.artifact.findFirst({ where: { id, userId } });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const artifact = await prisma.artifact.findFirst({
    where: { id, userId: session.userId },
    include: { project: { select: { id: true, name: true } } },
  });
  if (!artifact) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ artifact });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await findOwned(id, session.userId);
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.title === "string" && body.title.trim())
    data.title = body.title.trim();
  if (KINDS.includes(body.kind)) data.kind = body.kind;
  if (typeof body.content === "string") data.content = body.content;

  // Targeted find/replace edits (applied to current content in order).
  if (Array.isArray(body.edits)) {
    let content =
      typeof data.content === "string" ? (data.content as string) : existing.content;
    const failed: string[] = [];
    for (const e of body.edits) {
      if (typeof e?.find !== "string") continue;
      if (!content.includes(e.find)) {
        failed.push(e.find.slice(0, 80));
        continue;
      }
      content = content.replace(e.find, typeof e.replace === "string" ? e.replace : "");
    }
    if (failed.length) {
      return NextResponse.json(
        { error: `Edit text not found: ${failed.join(" | ")}` },
        { status: 409 }
      );
    }
    data.content = content;
  }

  if (body.projectId === null) data.projectId = null;
  else if (typeof body.projectId === "string") {
    const owns = await prisma.project.findFirst({
      where: { id: body.projectId, userId: session.userId },
    });
    if (!owns) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    data.projectId = body.projectId;
  }

  const artifact = await prisma.artifact.update({
    where: { id: existing.id },
    data,
    include: { project: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ artifact });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await findOwned(id, session.userId);
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.artifact.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
