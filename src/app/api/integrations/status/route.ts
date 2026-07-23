import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { integrationsStatus } from "@/lib/integrations/status";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const force = req.nextUrl.searchParams.get("force") === "1";
  const status = await integrationsStatus(force);
  return NextResponse.json(status);
}
