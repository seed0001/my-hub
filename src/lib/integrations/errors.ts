/**
 * Stable error taxonomy for the GitHub/Railway integration layer.
 * Every failure surfaced to Andrew, the audit log, or the UI carries one of
 * these categories plus a sanitized, actionable message.
 */

export const ERROR_CATEGORIES = [
  "CLI_NOT_INSTALLED",
  "NOT_AUTHENTICATED",
  "PERMISSION_DENIED",
  "VALIDATION_ERROR",
  "CONFIRMATION_REQUIRED",
  "RATE_LIMITED",
  "TIMEOUT",
  "COMMAND_FAILED",
  "API_ERROR",
  "PARTIAL_FAILURE",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export class IntegrationError extends Error {
  readonly category: ErrorCategory;
  /** Optional short hint telling the user how to fix it. */
  readonly hint?: string;

  constructor(category: ErrorCategory, message: string, hint?: string) {
    super(message);
    this.name = "IntegrationError";
    this.category = category;
    this.hint = hint;
  }
}

export function isIntegrationError(e: unknown): e is IntegrationError {
  return e instanceof IntegrationError;
}

/** Wrap any thrown value into an IntegrationError without losing category. */
export function toIntegrationError(e: unknown): IntegrationError {
  if (isIntegrationError(e)) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new IntegrationError("COMMAND_FAILED", msg);
}
