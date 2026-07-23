import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * Pending-action confirmations for high-risk integration operations.
 *
 * A confirmation is bound to: the authenticated user, the exact tool, and a
 * hash of the normalized arguments. It expires quickly and is single-use
 * (consumed atomically). Any argument change invalidates it. Conversational
 * approval earlier in a chat never substitutes for a live confirmation id.
 */

export const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

/** Deterministic JSON with sorted keys; confirmationId itself is excluded. */
export function normalizeArgs(args: Record<string, unknown>): string {
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>)
        .filter(([k, val]) => k !== "confirmationId" && val !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(entries.map(([k, val]) => [k, clean(val)]));
    }
    return v;
  };
  return JSON.stringify(clean(args));
}

export function hashArgs(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

export type ConfirmCheck =
  | { status: "confirmed" }
  | {
      status: "pending";
      confirmationId: string;
      summary: string;
      expiresInSeconds: number;
    }
  | { status: "invalid"; reason: string };

/**
 * Gate for a high-risk tool call.
 *
 * Without `confirmationId`: records a pending action and returns its id +
 * impact summary (the tool must NOT execute).
 * With one: validates binding (user, tool, args hash, expiry) and consumes it
 * atomically so it can never be replayed.
 */
export async function checkConfirmation(params: {
  userId: string;
  tool: string;
  args: Record<string, unknown>;
  confirmationId?: string;
  summary: string;
}): Promise<ConfirmCheck> {
  const normalized = normalizeArgs(params.args);
  const argsHash = hashArgs(normalized);

  if (!params.confirmationId) {
    const pending = await prisma.pendingAction.create({
      data: {
        userId: params.userId,
        tool: params.tool,
        argsHash,
        argsJson: normalized.slice(0, 8000),
        summary: params.summary.slice(0, 2000),
        expiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS),
      },
    });
    return {
      status: "pending",
      confirmationId: pending.id,
      summary: params.summary,
      expiresInSeconds: Math.round(CONFIRMATION_TTL_MS / 1000),
    };
  }

  const row = await prisma.pendingAction.findUnique({
    where: { id: params.confirmationId },
  });
  if (!row || row.userId !== params.userId || row.tool !== params.tool)
    return { status: "invalid", reason: "Confirmation not found for this action." };
  if (row.argsHash !== argsHash)
    return {
      status: "invalid",
      reason:
        "The arguments changed since the confirmation was issued. Ask the user again and request a fresh confirmation.",
    };
  if (row.consumedAt)
    return { status: "invalid", reason: "This confirmation was already used." };
  if (row.expiresAt.getTime() < Date.now())
    return { status: "invalid", reason: "This confirmation expired. Request a fresh one." };

  // Atomic single-use consumption — guards concurrent replay.
  const consumed = await prisma.pendingAction.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1)
    return { status: "invalid", reason: "This confirmation was already used." };

  return { status: "confirmed" };
}
