import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { integrationsStatus } from "@/lib/integrations/status";
import { redact } from "@/lib/integrations/redact";

export const runtime = "nodejs";

/**
 * Copyable, sanitized diagnostic report: versions, connection states, and
 * recent error categories with correlation ids. Never credentials.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [status, recentErrors] = await Promise.all([
    integrationsStatus(),
    prisma.integrationLog.findMany({
      where: {
        OR: [{ userId: session.userId }, { userId: null }],
        outcome: { in: ["FAILURE", "CANCELLED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const lines = [
    `my-hub integrations diagnostic report`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `GitHub CLI: ${status.github.installed ? `installed v${status.github.version ?? "?"}` : "not installed"}`,
    `GitHub auth: ${status.github.state}${status.github.account ? ` (${status.github.account})` : ""}`,
    `GitHub detail: ${redact(status.github.detail)}`,
    ``,
    `Railway CLI: ${status.railway.installed ? `installed v${status.railway.version ?? "?"}` : "not installed"}`,
    `Railway auth: ${status.railway.state}${status.railway.account ? ` (${status.railway.account})` : ""}`,
    `Railway API token configured: ${status.railway.apiTokenConfigured ? "yes" : "no"}`,
    `Railway detail: ${redact(status.railway.detail)}`,
    ``,
    `Recent errors (newest first):`,
    ...(recentErrors.length
      ? recentErrors.map(
          (l) =>
            `- ${l.createdAt.toISOString()} [${l.integration}] ${l.tool} → ${l.errorCategory ?? "?"} (correlation ${l.correlationId})`
        )
      : ["- none"]),
  ];

  return new NextResponse(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
