import { IntegrationError } from "./errors";
import { runCli } from "./runner";

/**
 * Typed Railway adapter. Pass 1 ships connection diagnostics; project,
 * deployment, and configuration operations land in Pass 2 (CLI where it
 * supports non-interactive use, Railway's documented public GraphQL API
 * behind the same typed surface where it doesn't).
 */

export interface RailwayStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  account: string | null;
  apiTokenConfigured: boolean;
  state: "connected" | "degraded" | "disconnected" | "unavailable";
  detail: string;
}

export async function railwayStatus(): Promise<RailwayStatus> {
  const apiTokenConfigured = Boolean(process.env.RAILWAY_API_TOKEN);
  let version: string | null = null;
  let installed = false;

  try {
    const out = await runCli("railway", ["--version"], { timeoutMs: 10_000 });
    installed = out.exitCode === 0;
    version = out.stdout.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  } catch (err) {
    const e = err as IntegrationError;
    if (e.category === "CLI_NOT_INSTALLED") {
      // The API-token path can still work without the CLI.
      return {
        installed: false,
        version: null,
        authenticated: false,
        account: null,
        apiTokenConfigured,
        state: apiTokenConfigured ? "degraded" : "unavailable",
        detail: apiTokenConfigured
          ? "Railway CLI is not installed; API-token operations remain available."
          : "Railway CLI is not installed and no RAILWAY_API_TOKEN is set.",
      };
    }
    return {
      installed: false,
      version: null,
      authenticated: false,
      account: null,
      apiTokenConfigured,
      state: "unavailable",
      detail: e.message,
    };
  }

  try {
    const who = await runCli("railway", ["whoami"], { timeoutMs: 15_000 });
    if (who.exitCode === 0) {
      const account =
        who.stdout.match(/[\w.+-]+@[\w.-]+/)?.[0] ??
        who.stdout.trim().split("\n").pop()?.trim() ??
        null;
      return {
        installed: true,
        version,
        authenticated: true,
        account,
        apiTokenConfigured,
        state: "connected",
        detail: account ? `Authenticated as ${account}.` : "Authenticated.",
      };
    }
    return {
      installed: true,
      version,
      authenticated: false,
      account: null,
      apiTokenConfigured,
      state: apiTokenConfigured ? "degraded" : "disconnected",
      detail:
        "Railway CLI is installed but not authenticated. Set RAILWAY_TOKEN (and RAILWAY_API_TOKEN for API operations) on the server.",
    };
  } catch (err) {
    const e = err as IntegrationError;
    return {
      installed: true,
      version,
      authenticated: false,
      account: null,
      apiTokenConfigured,
      state: "degraded",
      detail: e.message,
    };
  }
}
