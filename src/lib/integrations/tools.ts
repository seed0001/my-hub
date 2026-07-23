import { GITHUB_TOOL_DEFS, executeGithubTool, isGithubTool } from "./githubTools";
import { RAILWAY_TOOL_DEFS, executeRailwayTool, isRailwayTool } from "./railwayTools";
import type { GuardedOutcome } from "./guard";

/** Combined registry for all integration tools (GitHub + Railway). */

export const INTEGRATION_TOOL_DEFS = [
  ...GITHUB_TOOL_DEFS,
  ...RAILWAY_TOOL_DEFS,
] as const;

export function isIntegrationTool(name: string): boolean {
  return isGithubTool(name) || isRailwayTool(name);
}

export async function executeIntegrationTool(
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<GuardedOutcome> {
  if (isGithubTool(name)) return executeGithubTool(userId, name, args);
  return executeRailwayTool(userId, name, args);
}
