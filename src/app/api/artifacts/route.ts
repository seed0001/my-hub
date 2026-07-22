import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

const KINDS = ["roadmap", "spec", "note", "doc", "prompt"];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const artifacts = await prisma.artifact.findMany({
    where: { userId: session.userId },
    orderBy: { updatedAt: "desc" },
    include: { project: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ artifacts });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const title = String(body.title || "").trim();
  const content = String(body.content || "");
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  const kind = KINDS.includes(body.kind) ? body.kind : "doc";
  const projectId = body.projectId ? String(body.projectId) : null;
  if (projectId) {
    const owns = await prisma.project.findFirst({
      where: { id: projectId, userId: session.userId },
    });
    if (!owns) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const artifact = await prisma.artifact.create({
    data: { userId: session.userId, title, kind, content, projectId },
    include: { project: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ artifact });
}
