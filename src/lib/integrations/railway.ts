import { IntegrationError } from "./errors";
import { RE, assertId, parseJson, runCli } from "./runner";
import * as api from "./railwayApi";

/**
 * Typed Railway adapter. Uses the CLI where it works non-interactively
 * (version, whoami, project listing) and the documented public GraphQL API
 * (see railwayApi.ts) for everything the CLI does not expose to servers:
 * project/service/deployment inspection, logs, redeploy/cancel, domains,
 * variables, service settings, and deletes.
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

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const id = (v: unknown, what: string) => assertId(v, RE.railwayId, what);

function limit(v: unknown, def: number, max: number): number {
  const n = typeof v === "number" && isFinite(v) ? Math.floor(v) : def;
  return Math.min(Math.max(n, 1), max);
}

/** Environments whose name reads as production get extra confirmation. */
export function isProductionName(name: string): boolean {
  return /^prod(uction)?$/i.test(name.trim());
}

export async function environmentName(environmentId: string): Promise<string> {
  return api.apiEnvironmentName(id(environmentId, "environmentId"));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** API-first (works without the CLI); falls back to `railway list --json`. */
export async function listProjects(): Promise<
  Array<{ id: string | null; name: string }>
> {
  if (api.apiConfigured()) {
    const projects = await api.apiListProjects();
    return projects.map((p) => ({ id: p.id, name: p.name }));
  }
  const res = await runCli("railway", ["list", "--json"], { timeoutMs: 30_000 });
  if (res.exitCode !== 0)
    throw new IntegrationError(
      "COMMAND_FAILED",
      `list Railway projects: railway CLI exited ${res.exitCode}. ${res.stderr.slice(0, 300)}`,
      "Set RAILWAY_API_TOKEN for API-based listing, or authenticate the CLI."
    );
  const parsed = parseJson<unknown>(res.stdout, "list Railway projects");
  const rows = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Object.values(parsed as Record<string, unknown>).flat()
      : [];
  return rows
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      id: typeof r.id === "string" ? r.id : null,
      name: String(r.name ?? "unknown"),
    }));
}

export async function projectView(projectId: string) {
  return api.apiProjectView(id(projectId, "projectId"));
}

export async function listDeployments(params: {
  projectId: string;
  environmentId?: string;
  serviceId?: string;
  limit?: number;
}) {
  return api.apiListDeployments({
    projectId: id(params.projectId, "projectId"),
    environmentId: params.environmentId ? id(params.environmentId, "environmentId") : undefined,
    serviceId: params.serviceId ? id(params.serviceId, "serviceId") : undefined,
    limit: limit(params.limit, 10, 50),
  });
}

export async function deploymentView(deploymentId: string) {
  return api.apiDeploymentView(id(deploymentId, "deploymentId"));
}

export const MAX_LOG_LINES = 500;

export async function deploymentLogs(params: {
  deploymentId: string;
  kind?: "build" | "deploy";
  lines?: number;
}) {
  const kind = params.kind === "build" ? "build" : "deploy";
  const rows = await api.apiLogs({
    deploymentId: id(params.deploymentId, "deploymentId"),
    kind,
    limit: limit(params.lines, 100, MAX_LOG_LINES),
  });
  return { kind, lineCount: rows.length, truncatedTo: limit(params.lines, 100, MAX_LOG_LINES), lines: rows };
}

/** Names only — variable values never reach the model. */
export async function variableNames(params: {
  projectId: string;
  environmentId: string;
  serviceId?: string;
}) {
  return api.apiVariableNames({
    projectId: id(params.projectId, "projectId"),
    environmentId: id(params.environmentId, "environmentId"),
    serviceId: params.serviceId ? id(params.serviceId, "serviceId") : undefined,
  });
}

export async function listDomains(params: {
  projectId: string;
  environmentId: string;
  serviceId: string;
}) {
  return api.apiDomains({
    projectId: id(params.projectId, "projectId"),
    environmentId: id(params.environmentId, "environmentId"),
    serviceId: id(params.serviceId, "serviceId"),
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createProject(name: string) {
  assertId(name, RE.railwayName, "project name");
  return api.apiProjectCreate(name);
}

export async function createService(params: {
  projectId: string;
  repo?: string;
  branch?: string;
  name?: string;
}) {
  if (params.repo) assertId(params.repo, RE.ghRepoFull, "repo (owner/repo)");
  if (params.branch) assertId(params.branch, RE.branch, "branch");
  if (params.name) assertId(params.name, RE.railwayName, "service name");
  return api.apiServiceCreate({
    projectId: id(params.projectId, "projectId"),
    repo: params.repo,
    branch: params.branch,
    name: params.name,
  });
}

export async function redeploy(params: { serviceId: string; environmentId: string }) {
  await api.apiServiceInstanceRedeploy({
    serviceId: id(params.serviceId, "serviceId"),
    environmentId: id(params.environmentId, "environmentId"),
  });
  return { redeployed: true };
}

export async function cancelDeployment(deploymentId: string) {
  await api.apiDeploymentCancel(id(deploymentId, "deploymentId"));
  return { cancelled: deploymentId };
}

export async function variableUpsert(params: {
  projectId: string;
  environmentId: string;
  serviceId?: string;
  name: string;
  value: string;
}) {
  assertId(params.name, RE.envVarName, "variable name");
  await api.apiVariableUpsert({
    projectId: id(params.projectId, "projectId"),
    environmentId: id(params.environmentId, "environmentId"),
    serviceId: params.serviceId ? id(params.serviceId, "serviceId") : undefined,
    name: params.name,
    value: params.value,
  });
  return { set: params.name };
}

export async function variableDelete(params: {
  projectId: string;
  environmentId: string;
  serviceId?: string;
  name: string;
}) {
  assertId(params.name, RE.envVarName, "variable name");
  await api.apiVariableDelete({
    projectId: id(params.projectId, "projectId"),
    environmentId: id(params.environmentId, "environmentId"),
    serviceId: params.serviceId ? id(params.serviceId, "serviceId") : undefined,
    name: params.name,
  });
  return { deleted: params.name };
}

export async function domainCreate(params: { environmentId: string; serviceId: string }) {
  return api.apiServiceDomainCreate({
    environmentId: id(params.environmentId, "environmentId"),
    serviceId: id(params.serviceId, "serviceId"),
  });
}

export async function domainDelete(domainId: string) {
  await api.apiServiceDomainDelete(id(domainId, "domainId"));
  return { removed: domainId };
}

const SERVICE_SETTING_KEYS = [
  "sourceBranch",
  "buildCommand",
  "startCommand",
  "healthcheckPath",
  "restartPolicyType",
] as const;

export type ServiceSettingKey = (typeof SERVICE_SETTING_KEYS)[number];

export async function updateServiceSettings(params: {
  serviceId: string;
  environmentId: string;
  settings: Partial<Record<ServiceSettingKey, string>>;
}) {
  const input: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const key of SERVICE_SETTING_KEYS) {
    const value = params.settings[key];
    if (value === undefined) continue;
    if (key === "sourceBranch") {
      assertId(value, RE.branch, "sourceBranch");
      input.source = { branch: value };
    } else if (key === "restartPolicyType") {
      if (!["ON_FAILURE", "ALWAYS", "NEVER"].includes(value))
        throw new IntegrationError(
          "VALIDATION_ERROR",
          "restartPolicyType must be ON_FAILURE, ALWAYS, or NEVER"
        );
      input.restartPolicyType = value;
    } else {
      if (value.includes("\0") || value.length > 2000)
        throw new IntegrationError("VALIDATION_ERROR", `${key} is invalid`);
      input[key] = value;
    }
    changed.push(key);
  }
  if (changed.length === 0)
    throw new IntegrationError("VALIDATION_ERROR", "No settings to change were provided.");
  await api.apiServiceInstanceUpdate({
    serviceId: id(params.serviceId, "serviceId"),
    environmentId: id(params.environmentId, "environmentId"),
    input,
  });
  return { updated: changed };
}

// ---------------------------------------------------------------------------
// Deletes (only reachable through the confirmation gate)
// ---------------------------------------------------------------------------

export async function deleteProject(projectId: string) {
  await api.apiProjectDelete(id(projectId, "projectId"));
  return { deleted: projectId };
}

export async function deleteService(serviceId: string) {
  await api.apiServiceDelete(id(serviceId, "serviceId"));
  return { deleted: serviceId };
}

export async function deleteEnvironment(environmentId: string) {
  await api.apiEnvironmentDelete(id(environmentId, "environmentId"));
  return { deleted: environmentId };
}
