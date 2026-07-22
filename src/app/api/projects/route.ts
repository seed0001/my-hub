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

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projects = await prisma.project.findMany({
    where: { userId: session.userId },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    include: {
      updates: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const status = STATUSES.includes(body.status) ? body.status : "IDEA";

  const project = await prisma.project.create({
    data: {
      userId: session.userId,
      name,
      description: body.description ? String(body.description) : null,
      status,
      url: body.url ? String(body.url) : null,
      repoUrl: body.repoUrl ? String(body.repoUrl) : null,
      color: body.color ? String(body.color) : null,
    },
    include: { updates: true },
  });

  return NextResponse.json({ project });
}
