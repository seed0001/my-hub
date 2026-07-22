import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memories = await prisma.memory.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ memories });
}
