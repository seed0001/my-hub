import { newCorrelationId, recordAudit, type RiskClass } from "./audit";
import { checkConfirmation } from "./confirm";
import { isIntegrationError, toIntegrationError } from "./errors";

/**
 * Shared wrapper every integration tool call goes through:
 * confirmation gate (for high-risk operations) → execution → audit record.
 * Failures become structured, categorized results the model can act on —
 * never raw exceptions or unredacted output.
 */

/** Structurally compatible with agentTools' ToolOutcome. */
export interface GuardedOutcome {
  result: unknown;
  label?: string;
}

export async function runGuarded(opts: {
  userId: string;
  integration: "github" | "railway";
  tool: string;
  risk: RiskClass;
  /** Sanitized target identifier for the audit trail, e.g. "owner/repo". */
  target?: string;
  /** The raw tool args (used for confirmation binding). */
  args: Record<string, unknown>;
  /** Present ⇒ the operation requires an exact, single-use confirmation. */
  confirm?: { summary: string };
  execute: () => Promise<{ result: unknown; label?: string }>;
}): Promise<GuardedOutcome> {
  const correlationId = newCorrelationId();
  const started = Date.now();
  const base = {
    userId: opts.userId,
    integration: opts.integration,
    tool: opts.tool,
    correlationId,
    riskClass: opts.risk,
    target: opts.target ?? null,
  } as const;

  let confirmation: "not_required" | "required" | "confirmed" = "not_required";

  if (opts.confirm) {
    confirmation = "required";
    let check;
    try {
      check = await checkConfirmation({
        userId: opts.userId,
        tool: opts.tool,
        args: opts.args,
        confirmationId:
          typeof opts.args.confirmationId === "string" ? opts.args.confirmationId : undefined,
        summary: opts.confirm.summary,
      });
    } catch (err) {
      const e = toIntegrationError(err);
      await recordAudit({ ...base, confirmation, outcome: "FAILURE", errorCategory: e.category, errorMessage: e.message, durationMs: Date.now() - started });
      return {
        result: { error: e.message, category: e.category, correlationId },
        label: `❌ ${opts.tool} failed (${e.category})`,
      };
    }

    if (check.status === "pending") {
      await recordAudit({ ...base, confirmation, outcome: "BLOCKED", errorCategory: "CONFIRMATION_REQUIRED", errorMessage: opts.confirm.summary, durationMs: Date.now() - started });
      return {
        result: {
          confirmationRequired: true,
          category: "CONFIRMATION_REQUIRED",
          confirmationId: check.confirmationId,
          summary: check.summary,
          expiresInSeconds: check.expiresInSeconds,
          instructions:
            "Show the user this exact impact summary and ask them to approve. Only after they explicitly approve in their next message, call this same tool again with IDENTICAL arguments plus this confirmationId. If they decline or want changes, do not retry.",
          correlationId,
        },
        label: `⚠️ Needs confirmation: ${check.summary}`,
      };
    }
    if (check.status === "invalid") {
      await recordAudit({ ...base, confirmation, outcome: "BLOCKED", errorCategory: "CONFIRMATION_REQUIRED", errorMessage: check.reason, durationMs: Date.now() - started });
      return {
        result: { error: check.reason, category: "CONFIRMATION_REQUIRED", correlationId },
        label: `⚠️ Confirmation rejected: ${check.reason}`,
      };
    }
    confirmation = "confirmed";
  }

  try {
    const res = await opts.execute();
    await recordAudit({ ...base, confirmation, outcome: "SUCCESS", durationMs: Date.now() - started });
    const result =
      res.result && typeof res.result === "object" && !Array.isArray(res.result)
        ? { ...(res.result as Record<string, unknown>), correlationId }
        : { data: res.result, correlationId };
    return { result, label: res.label };
  } catch (err) {
    const e = toIntegrationError(err);
    const cancelled = e.category === "TIMEOUT";
    await recordAudit({
      ...base,
      confirmation,
      outcome: cancelled ? "CANCELLED" : "FAILURE",
      errorCategory: e.category,
      errorMessage: e.message,
      durationMs: Date.now() - started,
    });
    return {
      result: {
        error: e.message,
        category: e.category,
        ...(isIntegrationError(err) && err.hint ? { hint: err.hint } : {}),
        correlationId,
      },
      label: `❌ ${opts.tool} failed (${e.category})`,
    };
  }
}
