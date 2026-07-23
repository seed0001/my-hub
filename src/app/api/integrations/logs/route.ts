import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

/** Recent integration operations (sanitized audit rows) for the UI. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const integration = req.nextUrl.searchParams.get("integration");
  const outcome = req.nextUrl.searchParams.get("outcome");
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") || 50);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200);

  const logs = await prisma.integrationLog.findMany({
    where: {
      // Rows are the user's own actions plus system-initiated ones (userId null).
      OR: [{ userId: session.userId }, { userId: null }],
      ...(integration === "github" || integration === "railway" ? { integration } : {}),
      ...(outcome && ["SUCCESS", "FAILURE", "CANCELLED", "BLOCKED"].includes(outcome)
        ? { outcome }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ logs });
}
