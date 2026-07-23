import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { secretSet } from "@/lib/integrations/github";
import { setRailwaySecret } from "@/lib/integrations/railwaySecrets";
import { newCorrelationId, recordAudit } from "@/lib/integrations/audit";
import { toIntegrationError } from "@/lib/integrations/errors";

export const runtime = "nodejs";

/**
 * Protected secret-entry path. The value arrives directly from the
 * Integrations sheet over HTTPS, goes to the CLI via stdin (GitHub) or the
 * Railway API request body, and is never present in chat history, tool
 * results, audit rows, or logs. Submitting the form IS the explicit user
 * confirmation for this high-risk action.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const integration = body.integration === "railway" ? "railway" : "github";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const value = typeof body.value === "string" ? body.value : "";
  if (!name || !value)
    return NextResponse.json({ error: "name and value are required." }, { status: 400 });

  const correlationId = newCorrelationId();
  const started = Date.now();
  const audit = (outcome: "SUCCESS" | "FAILURE", target: string, errorCategory?: string, errorMessage?: string) =>
    recordAudit({
      userId: session.userId,
      integration,
      tool: "ui_secret_set",
      correlationId,
      riskClass: "DESTRUCTIVE",
      target,
      confirmation: "confirmed",
      outcome,
      errorCategory: errorCategory as never,
      errorMessage,
      durationMs: Date.now() - started,
    });

  try {
    if (integration === "github") {
      const repo = typeof body.repo === "string" ? body.repo.trim() : "";
      if (!repo)
        return NextResponse.json({ error: "repo (owner/repo) is required." }, { status: 400 });
      await secretSet(repo, name, value);
      await audit("SUCCESS", `${repo} secret:${name}`);
      return NextResponse.json({ ok: true, correlationId });
    }

    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const environmentId = typeof body.environmentId === "string" ? body.environmentId.trim() : "";
    const serviceId = typeof body.serviceId === "string" ? body.serviceId.trim() : "";
    if (!projectId || !environmentId)
      return NextResponse.json(
        { error: "projectId and environmentId are required for Railway secrets." },
        { status: 400 }
      );
    await setRailwaySecret({ projectId, environmentId, serviceId: serviceId || undefined, name, value });
    await audit("SUCCESS", `project:${projectId} var:${name}`);
    return NextResponse.json({ ok: true, correlationId });
  } catch (err) {
    const e = toIntegrationError(err);
    await audit("FAILURE", integration === "github" ? String(body.repo ?? "") : `project:${String(body.projectId ?? "")}`, e.category, e.message);
    return NextResponse.json(
      { error: e.message, category: e.category, hint: e.hint, correlationId },
      { status: 502 }
    );
  }
}
