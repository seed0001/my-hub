import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { redact } from "./redact";
import type { ErrorCategory } from "./errors";

/**
 * Durable audit trail for every attempted integration operation.
 * Rows never contain tokens, secret values, or unredacted output.
 */

export type RiskClass = "READ" | "WRITE" | "DESTRUCTIVE";
export type Outcome = "SUCCESS" | "FAILURE" | "CANCELLED" | "BLOCKED";
export type ConfirmationState = "not_required" | "required" | "confirmed";

export interface AuditEntry {
  userId: string | null;
  integration: "github" | "railway";
  tool: string;
  correlationId: string;
  riskClass: RiskClass;
  target?: string | null;
  confirmation: ConfirmationState;
  outcome: Outcome;
  errorCategory?: ErrorCategory | null;
  errorMessage?: string | null;
  durationMs: number;
}

export function newCorrelationId(): string {
  return randomUUID();
}

/** Best-effort durable write; auditing must never crash the operation path. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.integrationLog.create({
      data: {
        userId: entry.userId,
        integration: entry.integration,
        tool: entry.tool,
        correlationId: entry.correlationId,
        riskClass: entry.riskClass,
        target: entry.target ? redact(entry.target).slice(0, 300) : null,
        confirmation: entry.confirmation,
        outcome: entry.outcome,
        errorCategory: entry.errorCategory ?? null,
        errorMessage: entry.errorMessage
          ? redact(entry.errorMessage).slice(0, 4000)
          : null,
        durationMs: Math.max(0, Math.round(entry.durationMs)),
      },
    });
  } catch (err) {
    console.error("[integrations] audit write failed", err);
  }
}
