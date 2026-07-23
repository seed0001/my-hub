import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setFetchImplForTests, railwayGraphQL } from "../railwayApi";
import * as rw from "../railway";
import { __setExecImplForTests } from "../runner";

type FetchCall = { url: string; init: RequestInit };
let fetchCalls: FetchCall[] = [];

function mockApi(
  responder: (body: { query: string; variables: Record<string, unknown> }) =>
    | { status?: number; json?: unknown }
    | Promise<{ status?: number; json?: unknown }>
) {
  __setFetchImplForTests(async (url, init) => {
    fetchCalls.push({ url: String(url), init: init as RequestInit });
    const parsed = JSON.parse(String((init as RequestInit).body));
    const res = await responder(parsed);
    return new Response(JSON.stringify(res.json ?? {}), {
      status: res.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

beforeEach(() => {
  fetchCalls = [];
  vi.stubEnv("RAILWAY_API_TOKEN", "test-api-token");
});

afterEach(() => {
  __setFetchImplForTests(null);
  __setExecImplForTests(null);
  vi.unstubAllEnvs();
});

describe("railwayGraphQL", () => {
  it("sends a bearer token and returns data", async () => {
    mockApi(() => ({ json: { data: { me: { name: "Travis" } } } }));
    const data = await railwayGraphQL<{ me: { name: string } }>("who", "query { me { name } }");
    expect(data.me.name).toBe("Travis");
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-api-token");
  });

  it("fails NOT_AUTHENTICATED without a token, before any network call", async () => {
    vi.stubEnv("RAILWAY_API_TOKEN", "");
    mockApi(() => ({ json: {} }));
    await expect(railwayGraphQL("who", "query { me }")).rejects.toMatchObject({
      category: "NOT_AUTHENTICATED",
    });
    expect(fetchCalls).toHaveLength(0);
  });

  it("maps HTTP 429 to RATE_LIMITED and 401 to NOT_AUTHENTICATED", async () => {
    mockApi(() => ({ status: 429 }));
    await expect(railwayGraphQL("x", "query { me }")).rejects.toMatchObject({ category: "RATE_LIMITED" });
    mockApi(() => ({ status: 401 }));
    await expect(railwayGraphQL("x", "query { me }")).rejects.toMatchObject({ category: "NOT_AUTHENTICATED" });
  });

  it("maps GraphQL 'Not Authorized' errors to PERMISSION_DENIED", async () => {
    mockApi(() => ({ json: { errors: [{ message: "Not Authorized to access project" }] } }));
    await expect(railwayGraphQL("x", "query { project }")).rejects.toMatchObject({
      category: "PERMISSION_DENIED",
    });
  });

  it("surfaces other GraphQL errors as API_ERROR with redacted message", async () => {
    mockApi(() => ({
      json: { errors: [{ message: "boom token=ghp_abcdefghijklmnopqrstuvwxyz123456" }] },
    }));
    await expect(railwayGraphQL("x", "query { me }")).rejects.toMatchObject({
      category: "API_ERROR",
      message: expect.not.stringContaining("ghp_abcdefghijklmnopqrst"),
    });
  });
});

describe("adapter reads", () => {
  it("projectView normalizes environments and services", async () => {
    mockApi(() => ({
      json: {
        data: {
          project: {
            id: "proj-1", name: "my-hub",
            environments: { edges: [{ node: { id: "env-1", name: "production" } }] },
            services: { edges: [{ node: { id: "svc-1", name: "web" } }] },
          },
        },
      },
    }));
    const p = await rw.projectView("proj-123456");
    expect(p.environments).toEqual([{ id: "env-1", name: "production" }]);
    expect(p.services).toEqual([{ id: "svc-1", name: "web" }]);
  });

  it("rejects malformed ids before any network call", async () => {
    mockApi(() => ({ json: { data: {} } }));
    await expect(rw.projectView("bad id!")).rejects.toMatchObject({ category: "VALIDATION_ERROR" });
    await expect(rw.deploymentView("-flag")).rejects.toMatchObject({ category: "VALIDATION_ERROR" });
    expect(fetchCalls).toHaveLength(0);
  });

  it("bounds deployment log requests and redacts messages", async () => {
    mockApi((body) => {
      expect(body.variables.limit).toBeLessThanOrEqual(rw.MAX_LOG_LINES);
      return {
        json: {
          data: {
            deploymentLogs: [
              { timestamp: "t1", severity: "info", message: "DATABASE_URL=postgres://u:pw@host/db" },
            ],
          },
        },
      };
    });
    const logs = await rw.deploymentLogs({ deploymentId: "deploy-123456", lines: 99999 });
    expect(logs.lines[0].message).not.toContain(":pw@");
  });

  it("variableNames returns names only, never values", async () => {
    mockApi(() => ({
      json: { data: { variables: { API_KEY: "super-secret-value", PORT: "3000" } } },
    }));
    const names = await rw.variableNames({ projectId: "proj-123456", environmentId: "env-123456" });
    expect(names.sort()).toEqual(["API_KEY", "PORT"]);
    expect(JSON.stringify(names)).not.toContain("super-secret-value");
  });

  it("listProjects falls back to the CLI when no API token is set", async () => {
    vi.stubEnv("RAILWAY_API_TOKEN", "");
    __setExecImplForTests(async (bin, args) => {
      expect(bin).toBe("railway");
      expect(args).toEqual(["list", "--json"]);
      return { stdout: JSON.stringify([{ id: "p1", name: "hub" }]), stderr: "", code: 0, killed: false };
    });
    const projects = await rw.listProjects();
    expect(projects).toEqual([{ id: "p1", name: "hub" }]);
  });
});

describe("adapter writes", () => {
  it("service settings validates restart policy and maps sourceBranch", async () => {
    let sent: Record<string, unknown> = {};
    mockApi((body) => {
      sent = body.variables as Record<string, unknown>;
      return { json: { data: { serviceInstanceUpdate: true } } };
    });
    await rw.updateServiceSettings({
      serviceId: "svc-123456",
      environmentId: "env-123456",
      settings: { sourceBranch: "main", startCommand: "npm run start" },
    });
    const input = sent.input as Record<string, unknown>;
    expect(input.source).toEqual({ branch: "main" });
    expect(input.startCommand).toBe("npm run start");

    await expect(
      rw.updateServiceSettings({
        serviceId: "svc-123456", environmentId: "env-123456",
        settings: { restartPolicyType: "SOMETIMES" },
      })
    ).rejects.toMatchObject({ category: "VALIDATION_ERROR" });
  });

  it("isProductionName flags production-like environments", () => {
    expect(rw.isProductionName("production")).toBe(true);
    expect(rw.isProductionName("Prod")).toBe(true);
    expect(rw.isProductionName("staging")).toBe(false);
    expect(rw.isProductionName("pr-preview")).toBe(false);
  });
});
