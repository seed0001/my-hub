import type { GuardedOutcome } from "./guard";

/**
 * Railway assistant tools — implemented in Pass 2.
 * Placeholder so the combined registry compiles after Pass 1.
 */

export const RAILWAY_TOOL_DEFS = [] as const;

export function isRailwayTool(name: string): boolean {
  return name.startsWith("railway_");
}

export async function executeRailwayTool(
  _userId: string,
  name: string,
  _args: Record<string, unknown>
): Promise<GuardedOutcome> {
  return {
    result: { error: `Railway integration not available yet: ${name}`, category: "VALIDATION_ERROR" },
  };
}
