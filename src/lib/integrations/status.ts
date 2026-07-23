import { githubStatus, type GithubStatus } from "./github";
import { railwayStatus, type RailwayStatus } from "./railway";

/**
 * Combined integration status with a short in-memory cache so the UI and
 * status tools don't hammer the CLIs.
 */

export interface IntegrationsStatus {
  github: GithubStatus;
  railway: RailwayStatus;
  checkedAt: string;
}

const CACHE_MS = 60_000;
let cache: { at: number; value: IntegrationsStatus } | null = null;

export async function integrationsStatus(force = false): Promise<IntegrationsStatus> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const [github, railway] = await Promise.all([githubStatus(), railwayStatus()]);
  const value: IntegrationsStatus = {
    github,
    railway,
    checkedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), value };
  return value;
}
