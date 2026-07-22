import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, userId: session.userId },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const text = String(body.body || "").trim();
  if (!text) return NextResponse.json({ error: "Update text required." }, { status: 400 });

  const update = await prisma.projectUpdate.create({
    data: { projectId: id, body: text },
  });

  // Touch the project so it sorts to the top by recent activity.
  await prisma.project.update({
    where: { id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({ update });
}
