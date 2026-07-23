import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./helpers/fakeDb";

vi.mock("@/lib/db", async () => {
  const { createFakeDb } = await import("./helpers/fakeDb");
  return { prisma: createFakeDb() };
});

vi.mock("../railway", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../railway")>();
  return {
    ...orig,
    railwayStatus: vi.fn(),
    listProjects: vi.fn(),
    projectView: vi.fn(),
    listDeployments: vi.fn(),
    deploymentView: vi.fn(),
    deploymentLogs: vi.fn(),
    variableNames: vi.fn(),
    listDomains: vi.fn(),
    createProject: vi.fn(),
    createService: vi.fn(),
    redeploy: vi.fn(),
    cancelDeployment: vi.fn(),
    variableUpsert: vi.fn(),
    variableDelete: vi.fn(),
    domainCreate: vi.fn(),
    domainDelete: vi.fn(),
    updateServiceSettings: vi.fn(),
    deleteProject: vi.fn(),
    deleteService: vi.fn(),
    deleteEnvironment: vi.fn(),
    environmentName: vi.fn(),
  };
});

import { prisma } from "@/lib/db";
import * as rw from "../railway";
import { executeRailwayTool } from "../railwayTools";

const db = prisma as unknown as FakeDb;
const USER = "user1";

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
});

function res(out: { result: unknown }): Record<string, unknown> {
  return out.result as Record<string, unknown>;
}

describe("reads", () => {
  it("deployment view returns a stable id for later polling", async () => {
    vi.mocked(rw.deploymentView).mockResolvedValue({
      id: "dep-1", status: "BUILDING", createdAt: "t", url: null, staticUrl: null,
    });
    const out = await executeRailwayTool(USER, "railway_deployment_view", { deploymentId: "dep-1" });
    expect(res(out).id).toBe("dep-1");
    expect(res(out).status).toBe("BUILDING");
    expect(db.integrationLog.rows[0]).toMatchObject({ riskClass: "READ", outcome: "SUCCESS" });
  });

  it("variables tool relays names only", async () => {
    vi.mocked(rw.variableNames).mockResolvedValue(["A", "B"]);
    const out = await executeRailwayTool(USER, "railway_variables", {
      projectId: "p-123456", environmentId: "e-123456",
    });
    expect(res(out).names).toEqual(["A", "B"]);
  });
});

describe("production confirmation enforcement", () => {
  it("redeploy of a production environment requires confirmation, then executes", async () => {
    vi.mocked(rw.environmentName).mockResolvedValue("production");
    vi.mocked(rw.redeploy).mockResolvedValue({ redeployed: true });
    const args = { serviceId: "svc-123456", environmentId: "env-123456" };

    const first = await executeRailwayTool(USER, "railway_redeploy", args);
    expect(res(first).confirmationRequired).toBe(true);
    expect(String(res(first).summary)).toMatch(/production/i);
    expect(rw.redeploy).not.toHaveBeenCalled();

    const second = await executeRailwayTool(USER, "railway_redeploy", {
      ...args, confirmationId: res(first).confirmationId,
    });
    expect(res(second).redeployed).toBe(true);
    expect(rw.redeploy).toHaveBeenCalledOnce();
  });

  it("redeploy of a non-production environment executes directly", async () => {
    vi.mocked(rw.environmentName).mockResolvedValue("staging");
    vi.mocked(rw.redeploy).mockResolvedValue({ redeployed: true });
    const out = await executeRailwayTool(USER, "railway_redeploy", {
      serviceId: "svc-123456", environmentId: "env-123456",
    });
    expect(res(out).redeployed).toBe(true);
  });

  it("treats an unresolvable environment as production (cautious default)", async () => {
    vi.mocked(rw.environmentName).mockRejectedValue(new Error("api down"));
    const out = await executeRailwayTool(USER, "railway_redeploy", {
      serviceId: "svc-123456", environmentId: "env-123456",
    });
    expect(res(out).confirmationRequired).toBe(true);
    expect(rw.redeploy).not.toHaveBeenCalled();
  });
});

describe("variable write policy", () => {
  it("creating a new variable is a plain write", async () => {
    vi.mocked(rw.variableNames).mockResolvedValue(["OTHER"]);
    vi.mocked(rw.environmentName).mockResolvedValue("staging");
    vi.mocked(rw.variableUpsert).mockResolvedValue({ set: "NEW_VAR" });
    const out = await executeRailwayTool(USER, "railway_variable_write", {
      action: "set", projectId: "p-123456", environmentId: "e-123456",
      name: "NEW_VAR", value: "hello",
    });
    expect(res(out).set).toBe("NEW_VAR");
  });

  it("overwriting an existing variable demands confirmation", async () => {
    vi.mocked(rw.variableNames).mockResolvedValue(["EXISTING"]);
    vi.mocked(rw.environmentName).mockResolvedValue("staging");
    const out = await executeRailwayTool(USER, "railway_variable_write", {
      action: "set", projectId: "p-123456", environmentId: "e-123456",
      name: "EXISTING", value: "new-value",
    });
    expect(res(out).confirmationRequired).toBe(true);
    expect(rw.variableUpsert).not.toHaveBeenCalled();
  });

  it("deleting a variable demands confirmation", async () => {
    const out = await executeRailwayTool(USER, "railway_variable_write", {
      action: "delete", projectId: "p-123456", environmentId: "e-123456", name: "X",
    });
    expect(res(out).confirmationRequired).toBe(true);
    expect(rw.variableDelete).not.toHaveBeenCalled();
  });
});

describe("domain + settings gating", () => {
  it("generating a public domain demands confirmation (public exposure)", async () => {
    const out = await executeRailwayTool(USER, "railway_domain_write", {
      action: "generate", environmentId: "e-123456", serviceId: "s-123456",
    });
    expect(res(out).confirmationRequired).toBe(true);
    expect(rw.domainCreate).not.toHaveBeenCalled();
  });

  it("service settings changes always demand confirmation", async () => {
    vi.mocked(rw.environmentName).mockResolvedValue("staging");
    const out = await executeRailwayTool(USER, "railway_service_settings", {
      serviceId: "s-123456", environmentId: "e-123456", startCommand: "npm start",
    });
    expect(res(out).confirmationRequired).toBe(true);
    expect(rw.updateServiceSettings).not.toHaveBeenCalled();
  });
});

describe("delete tools", () => {
  const project = {
    id: "p-123456", name: "my-hub",
    environments: [{ id: "e-123456", name: "staging" }],
    services: [{ id: "s-123456", name: "web" }],
  };

  it("project delete requires exact confirmName and confirmation, then executes", async () => {
    vi.mocked(rw.projectView).mockResolvedValue(project);
    vi.mocked(rw.deleteProject).mockResolvedValue({ deleted: "p-123456" });

    const wrong = await executeRailwayTool(USER, "railway_delete_project", {
      projectId: "p-123456", confirmName: "other",
    });
    expect(res(wrong).category).toBe("VALIDATION_ERROR");

    const first = await executeRailwayTool(USER, "railway_delete_project", {
      projectId: "p-123456", confirmName: "my-hub",
    });
    expect(res(first).confirmationRequired).toBe(true);

    const second = await executeRailwayTool(USER, "railway_delete_project", {
      projectId: "p-123456", confirmName: "my-hub", confirmationId: res(first).confirmationId,
    });
    expect(res(second).deleted).toBe("p-123456");
    expect(rw.deleteProject).toHaveBeenCalledOnce();
    expect(db.integrationLog.rows.at(-1)).toMatchObject({
      outcome: "SUCCESS", riskClass: "DESTRUCTIVE", confirmation: "confirmed",
    });
  });

  it("service delete verifies the service exists and the name matches", async () => {
    vi.mocked(rw.projectView).mockResolvedValue(project);
    const missing = await executeRailwayTool(USER, "railway_delete_service", {
      projectId: "p-123456", serviceId: "s-nope99", confirmName: "web",
    });
    expect(res(missing).category).toBe("VALIDATION_ERROR");
    expect(rw.deleteService).not.toHaveBeenCalled();
  });

  it("environment delete verifies name binding", async () => {
    vi.mocked(rw.projectView).mockResolvedValue(project);
    const out = await executeRailwayTool(USER, "railway_delete_environment", {
      projectId: "p-123456", environmentId: "e-123456", confirmName: "production",
    });
    expect(res(out).category).toBe("VALIDATION_ERROR");
    expect(rw.deleteEnvironment).not.toHaveBeenCalled();
  });
});

describe("failure surfacing", () => {
  it("API failures during pre-checks come back structured, and are audited on execution paths", async () => {
    const { IntegrationError } = await import("../errors");
    vi.mocked(rw.projectView).mockRejectedValue(
      new IntegrationError("RATE_LIMITED", "Railway API rate limit exceeded.")
    );
    const out = await executeRailwayTool(USER, "railway_project_view", { projectId: "p-123456" });
    expect(res(out).category).toBe("RATE_LIMITED");
    expect(db.integrationLog.rows[0]).toMatchObject({
      outcome: "FAILURE", errorCategory: "RATE_LIMITED",
    });
  });
});
