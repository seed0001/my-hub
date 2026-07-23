import { IntegrationError } from "./errors";
import { redact, redactDeep } from "./redact";

/**
 * Minimal typed client for Railway's documented public GraphQL API.
 *
 * Why the API and not only the CLI: the Railway CLI is directory-context
 * oriented and interactive for most management operations — it does not
 * expose project/service/deployment inspection, deployment cancellation,
 * domains, or service settings non-interactively. Those operations use the
 * public API behind this single module.
 *
 * Every query/mutation string lives HERE so any schema drift is corrected in
 * one place. Written against the public API as documented at
 * docs.railway.com/reference/public-api (endpoint backboard.railway.com/graphql/v2,
 * bearer-token auth, rate-limited with 429 responses). Verify on first deploy;
 * schema errors surface as structured API_ERROR results, never crashes.
 */

const DEFAULT_ENDPOINT = "https://backboard.railway.com/graphql/v2";
const TIMEOUT_MS = 30_000;

type Json = Record<string, unknown>;

type FetchImpl = typeof fetch;
let fetchImpl: FetchImpl = (...args) => fetch(...args);

/** Test hook: replace the HTTP implementation. */
export function __setFetchImplForTests(impl: FetchImpl | null): void {
  fetchImpl = impl ?? ((...args) => fetch(...args));
}

export function apiConfigured(): boolean {
  return Boolean(process.env.RAILWAY_API_TOKEN);
}

export async function railwayGraphQL<T>(
  context: string,
  query: string,
  variables: Json = {}
): Promise<T> {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token)
    throw new IntegrationError(
      "NOT_AUTHENTICATED",
      `${context}: RAILWAY_API_TOKEN is not configured on the server.`,
      "Create a token in Railway → Account Settings → Tokens and set RAILWAY_API_TOKEN."
    );

  const endpoint = process.env.RAILWAY_API_URL || DEFAULT_ENDPOINT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError")
      throw new IntegrationError("TIMEOUT", `${context}: the Railway API timed out.`);
    throw new IntegrationError(
      "API_ERROR",
      `${context}: could not reach the Railway API. ${redact(String((err as Error).message ?? err))}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429)
    throw new IntegrationError("RATE_LIMITED", `${context}: Railway API rate limit exceeded. Try again later.`);
  if (res.status === 401 || res.status === 403)
    throw new IntegrationError(
      "NOT_AUTHENTICATED",
      `${context}: the Railway API rejected the token (HTTP ${res.status}).`,
      "Check that RAILWAY_API_TOKEN is valid and has access to this workspace."
    );
  if (!res.ok)
    throw new IntegrationError("API_ERROR", `${context}: Railway API returned HTTP ${res.status}.`);

  let body: { data?: T; errors?: Array<{ message?: string }> };
  try {
    body = (await res.json()) as never;
  } catch {
    throw new IntegrationError("API_ERROR", `${context}: Railway API returned malformed JSON.`);
  }

  if (body.errors?.length) {
    const msg = redact(body.errors.map((e) => e.message || "unknown error").join("; ")).slice(0, 400);
    if (/not authorized|unauthorized|permission/i.test(msg))
      throw new IntegrationError("PERMISSION_DENIED", `${context}: ${msg}`);
    if (/rate limit/i.test(msg))
      throw new IntegrationError("RATE_LIMITED", `${context}: ${msg}`);
    throw new IntegrationError("API_ERROR", `${context}: Railway API error — ${msg}`);
  }
  if (body.data === undefined)
    throw new IntegrationError("API_ERROR", `${context}: Railway API returned no data.`);
  return body.data;
}

// ---------------------------------------------------------------------------
// Typed operations (queries centralized here)
// ---------------------------------------------------------------------------

interface Edge<T> {
  node: T;
}
interface Connection<T> {
  edges: Edge<T>[];
}

export interface RailwayProjectSummary {
  id: string;
  name: string;
  updatedAt?: string;
}

export async function apiListProjects(): Promise<RailwayProjectSummary[]> {
  const data = await railwayGraphQL<{ projects: Connection<RailwayProjectSummary> }>(
    "list Railway projects",
    `query { projects { edges { node { id name updatedAt } } } }`
  );
  return (data.projects?.edges || []).map((e) => e.node);
}

export interface RailwayProjectDetail {
  id: string;
  name: string;
  environments: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
}

export async function apiProjectView(projectId: string): Promise<RailwayProjectDetail> {
  const data = await railwayGraphQL<{
    project: {
      id: string;
      name: string;
      environments: Connection<{ id: string; name: string }>;
      services: Connection<{ id: string; name: string }>;
    };
  }>(
    "view Railway project",
    `query ($id: String!) {
      project(id: $id) {
        id name
        environments { edges { node { id name } } }
        services { edges { node { id name } } }
      }
    }`,
    { id: projectId }
  );
  const p = data.project;
  return {
    id: p.id,
    name: p.name,
    environments: (p.environments?.edges || []).map((e) => e.node),
    services: (p.services?.edges || []).map((e) => e.node),
  };
}

export async function apiEnvironmentName(environmentId: string): Promise<string> {
  const data = await railwayGraphQL<{ environment: { name: string } }>(
    "resolve environment",
    `query ($id: String!) { environment(id: $id) { name } }`,
    { id: environmentId }
  );
  return data.environment?.name ?? "";
}

export interface RailwayDeployment {
  id: string;
  status: string;
  createdAt: string;
  url: string | null;
  staticUrl: string | null;
}

export async function apiListDeployments(params: {
  projectId: string;
  environmentId?: string;
  serviceId?: string;
  limit: number;
}): Promise<RailwayDeployment[]> {
  const data = await railwayGraphQL<{ deployments: Connection<RailwayDeployment> }>(
    "list deployments",
    `query ($first: Int!, $input: DeploymentListInput!) {
      deployments(first: $first, input: $input) {
        edges { node { id status createdAt url staticUrl } }
      }
    }`,
    {
      first: params.limit,
      input: {
        projectId: params.projectId,
        ...(params.environmentId ? { environmentId: params.environmentId } : {}),
        ...(params.serviceId ? { serviceId: params.serviceId } : {}),
      },
    }
  );
  return (data.deployments?.edges || []).map((e) => e.node);
}

export async function apiDeploymentView(deploymentId: string): Promise<RailwayDeployment> {
  const data = await railwayGraphQL<{ deployment: RailwayDeployment }>(
    "view deployment",
    `query ($id: String!) { deployment(id: $id) { id status createdAt url staticUrl } }`,
    { id: deploymentId }
  );
  return data.deployment;
}

export interface RailwayLogLine {
  timestamp: string;
  severity: string | null;
  message: string;
}

export async function apiLogs(params: {
  deploymentId: string;
  kind: "build" | "deploy";
  limit: number;
}): Promise<RailwayLogLine[]> {
  const field = params.kind === "build" ? "buildLogs" : "deploymentLogs";
  const data = await railwayGraphQL<Record<string, RailwayLogLine[]>>(
    `fetch ${params.kind} logs`,
    `query ($deploymentId: String!, $limit: Int!) {
      ${field}(deploymentId: $deploymentId, limit: $limit) { timestamp severity message }
    }`,
    { deploymentId: params.deploymentId, limit: params.limit }
  );
  const rows = data[field] || [];
  return rows.map((r) => ({
    timestamp: r.timestamp,
    severity: r.severity ?? null,
    message: redact(String(r.message ?? "")),
  }));
}

export async function apiVariableNames(params: {
  projectId: string;
  environmentId: string;
  serviceId?: string;
}): Promise<string[]> {
  const data = await railwayGraphQL<{ variables: Record<string, unknown> }>(
    "list variable names",
    `query ($projectId: String!, $environmentId: String!, $serviceId: String) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }`,
    {
      projectId: params.projectId,
      environmentId: params.environmentId,
      serviceId: params.serviceId ?? null,
    }
  );
  // The API returns a name→value map; values are dropped here on purpose.
  return Object.keys(data.variables || {});
}

export async function apiVariableUpsert(params: {
  projectId: string;
  environmentId: string;
  serviceId?: string;
  name: string;
  value: string;
}): Promise<void> {
  await railwayGraphQL(
    "upsert variable",
    `mutation ($input: VariableUpsertInput!) { variableUpsert(input: $input) }`,
    {
      input: {
        projectId: params.projectId,
        environmentId: params.environmentId,
        ...(params.serviceId ? { serviceId: params.serviceId } : {}),
        name: params.name,
        value: params.value,
      },
    }
  );
}

export async function apiVariableDelete(params: {
  projectId: string;
  environmentId: string;
  serviceId?: string;
  name: string;
}): Promise<void> {
  await railwayGraphQL(
    "delete variable",
    `mutation ($input: VariableDeleteInput!) { variableDelete(input: $input) }`,
    {
      input: {
        projectId: params.projectId,
        environmentId: params.environmentId,
        ...(params.serviceId ? { serviceId: params.serviceId } : {}),
        name: params.name,
      },
    }
  );
}

export async function apiProjectCreate(name: string): Promise<RailwayProjectSummary> {
  const data = await railwayGraphQL<{ projectCreate: RailwayProjectSummary }>(
    "create project",
    `mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { id name } }`,
    { input: { name } }
  );
  return data.projectCreate;
}

export async function apiServiceCreate(params: {
  projectId: string;
  repo?: string;
  branch?: string;
  name?: string;
}): Promise<{ id: string; name: string }> {
  const data = await railwayGraphQL<{ serviceCreate: { id: string; name: string } }>(
    "create service",
    `mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }`,
    {
      input: {
        projectId: params.projectId,
        ...(params.name ? { name: params.name } : {}),
        ...(params.repo
          ? { source: { repo: params.repo }, ...(params.branch ? { branch: params.branch } : {}) }
          : {}),
      },
    }
  );
  return data.serviceCreate;
}

export async function apiServiceInstanceRedeploy(params: {
  serviceId: string;
  environmentId: string;
}): Promise<void> {
  await railwayGraphQL(
    "redeploy service",
    `mutation ($serviceId: String!, $environmentId: String!) {
      serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    params
  );
}

export async function apiDeploymentCancel(deploymentId: string): Promise<void> {
  await railwayGraphQL(
    "cancel deployment",
    `mutation ($id: String!) { deploymentCancel(id: $id) }`,
    { id: deploymentId }
  );
}

export interface RailwayDomains {
  serviceDomains: Array<{ id: string; domain: string }>;
  customDomains: Array<{ id: string; domain: string }>;
}

export async function apiDomains(params: {
  projectId: string;
  environmentId: string;
  serviceId: string;
}): Promise<RailwayDomains> {
  const data = await railwayGraphQL<{ domains: RailwayDomains }>(
    "list domains",
    `query ($projectId: String!, $environmentId: String!, $serviceId: String!) {
      domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
        serviceDomains { id domain }
        customDomains { id domain }
      }
    }`,
    params
  );
  return redactDeep(data.domains);
}

export async function apiServiceDomainCreate(params: {
  environmentId: string;
  serviceId: string;
}): Promise<{ domain: string }> {
  const data = await railwayGraphQL<{ serviceDomainCreate: { domain: string } }>(
    "generate service domain",
    `mutation ($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }`,
    { input: params }
  );
  return data.serviceDomainCreate;
}

export async function apiServiceDomainDelete(id: string): Promise<void> {
  await railwayGraphQL(
    "remove service domain",
    `mutation ($id: String!) { serviceDomainDelete(id: $id) }`,
    { id }
  );
}

export async function apiServiceInstanceUpdate(params: {
  serviceId: string;
  environmentId: string;
  input: Record<string, unknown>;
}): Promise<void> {
  await railwayGraphQL(
    "update service settings",
    `mutation ($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`,
    params
  );
}

export async function apiProjectDelete(projectId: string): Promise<void> {
  await railwayGraphQL(
    "delete project",
    `mutation ($id: String!) { projectDelete(id: $id) }`,
    { id: projectId }
  );
}

export async function apiServiceDelete(serviceId: string): Promise<void> {
  await railwayGraphQL(
    "delete service",
    `mutation ($id: String!) { serviceDelete(id: $id) }`,
    { id: serviceId }
  );
}

export async function apiEnvironmentDelete(environmentId: string): Promise<void> {
  await railwayGraphQL(
    "delete environment",
    `mutation ($id: String!) { environmentDelete(id: $id) }`,
    { id: environmentId }
  );
}
