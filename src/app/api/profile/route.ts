import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
  });
  return NextResponse.json({
    profile: { content: profile?.content || "", updatedAt: profile?.updatedAt || null },
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (typeof body.content !== "string")
    return NextResponse.json({ error: "content is required." }, { status: 400 });

  const profile = await prisma.userProfile.upsert({
    where: { userId: session.userId },
    create: { userId: session.userId, content: body.content },
    update: { content: body.content },
  });
  return NextResponse.json({
    profile: { content: profile.content, updatedAt: profile.updatedAt },
  });
}
