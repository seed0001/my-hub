import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./helpers/fakeDb";

vi.mock("@/lib/db", async () => {
  const { createFakeDb } = await import("./helpers/fakeDb");
  return { prisma: createFakeDb() };
});

vi.mock("../github", () => ({
  githubStatus: vi.fn(),
  listRepos: vi.fn(),
  repoView: vi.fn(),
  repoInspect: vi.fn(),
  runView: vi.fn(),
  createRepo: vi.fn(),
  updateRepo: vi.fn(),
  issueWrite: vi.fn(),
  prWrite: vi.fn(),
  releaseWrite: vi.fn(),
  metaWrite: vi.fn(),
  workflowAction: vi.fn(),
  variableWrite: vi.fn(),
  deleteRepo: vi.fn(),
  setVisibility: vi.fn(),
  archiveRepo: vi.fn(),
  collaboratorWrite: vi.fn(),
  secretDelete: vi.fn(),
  secretSet: vi.fn(),
}));

import { prisma } from "@/lib/db";
import * as gh from "../github";
import { executeGithubTool } from "../githubTools";
import { IntegrationError } from "../errors";

const db = prisma as unknown as FakeDb;
const USER = "user1";

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
});

describe("read/write tools", () => {
  it("returns structured success with correlationId and audits it", async () => {
    vi.mocked(gh.repoView).mockResolvedValue({ nameWithOwner: "o/r" });
    const out = await executeGithubTool(USER, "github_repo_view", { repo: "o/r" });
    const result = out.result as Record<string, unknown>;
    expect(result.repo).toEqual({ nameWithOwner: "o/r" });
    expect(result.correlationId).toBeTruthy();
    expect(db.integrationLog.rows).toHaveLength(1);
    expect(db.integrationLog.rows[0]).toMatchObject({
      integration: "github",
      tool: "github_repo_view",
      riskClass: "READ",
      outcome: "SUCCESS",
      confirmation: "not_required",
    });
  });

  it("turns adapter failures into categorized results (not exceptions)", async () => {
    vi.mocked(gh.repoView).mockRejectedValue(
      new IntegrationError("PERMISSION_DENIED", "no access", "check scopes")
    );
    const out = await executeGithubTool(USER, "github_repo_view", { repo: "o/r" });
    const result = out.result as Record<string, unknown>;
    expect(result.category).toBe("PERMISSION_DENIED");
    expect(result.hint).toBe("check scopes");
    expect(result.correlationId).toBeTruthy();
    expect(db.integrationLog.rows[0]).toMatchObject({
      outcome: "FAILURE",
      errorCategory: "PERMISSION_DENIED",
    });
  });

  it("create repo executes without confirmation (normal write)", async () => {
    vi.mocked(gh.createRepo).mockResolvedValue({
      created: true, nameWithOwner: "seed0001/new", url: "https://github.com/seed0001/new",
      sshUrl: "git@github.com:seed0001/new.git", defaultBranch: "main", visibility: "private",
    } as never);
    const out = await executeGithubTool(USER, "github_create_repo", {
      name: "new", visibility: "private",
    });
    expect((out.result as Record<string, unknown>).url).toContain("github.com");
    expect(gh.createRepo).toHaveBeenCalledOnce();
  });
});

describe("confirmation enforcement", () => {
  it("delete repo without matching confirmRepo never reaches the adapter", async () => {
    const out = await executeGithubTool(USER, "github_delete_repo", {
      repo: "o/r", confirmRepo: "o/wrong",
    });
    expect((out.result as Record<string, unknown>).category).toBe("VALIDATION_ERROR");
    expect(gh.deleteRepo).not.toHaveBeenCalled();
  });

  it("delete repo requires the two-step confirmation and then executes", async () => {
    vi.mocked(gh.deleteRepo).mockResolvedValue({ deleted: "o/r" });
    const args = { repo: "o/r", confirmRepo: "o/r" };

    const first = await executeGithubTool(USER, "github_delete_repo", args);
    const r1 = first.result as Record<string, unknown>;
    expect(r1.confirmationRequired).toBe(true);
    expect(r1.summary).toMatch(/PERMANENTLY DELETE/);
    expect(gh.deleteRepo).not.toHaveBeenCalled();
    expect(db.integrationLog.rows[0]).toMatchObject({
      outcome: "BLOCKED",
      errorCategory: "CONFIRMATION_REQUIRED",
      riskClass: "DESTRUCTIVE",
    });

    const second = await executeGithubTool(USER, "github_delete_repo", {
      ...args, confirmationId: r1.confirmationId,
    });
    expect((second.result as Record<string, unknown>).deleted).toBe("o/r");
    expect(gh.deleteRepo).toHaveBeenCalledWith("o/r");
    expect(db.integrationLog.rows[1]).toMatchObject({
      outcome: "SUCCESS",
      confirmation: "confirmed",
    });
  });

  it("a confirmation issued for one target cannot authorize another", async () => {
    const first = await executeGithubTool(USER, "github_set_visibility", {
      repo: "o/r", visibility: "public",
    });
    const id = (first.result as Record<string, unknown>).confirmationId;
    const second = await executeGithubTool(USER, "github_set_visibility", {
      repo: "o/other", visibility: "public", confirmationId: id,
    });
    expect((second.result as Record<string, unknown>).category).toBe("CONFIRMATION_REQUIRED");
    expect(gh.setVisibility).not.toHaveBeenCalled();
  });

  it("consumed confirmations cannot be replayed", async () => {
    vi.mocked(gh.archiveRepo).mockResolvedValue({ repo: "o/r", archived: true });
    const args = { repo: "o/r", archived: true };
    const first = await executeGithubTool(USER, "github_archive_repo", args);
    const id = (first.result as Record<string, unknown>).confirmationId;
    await executeGithubTool(USER, "github_archive_repo", { ...args, confirmationId: id });
    const replay = await executeGithubTool(USER, "github_archive_repo", { ...args, confirmationId: id });
    expect((replay.result as Record<string, unknown>).category).toBe("CONFIRMATION_REQUIRED");
    expect(gh.archiveRepo).toHaveBeenCalledTimes(1);
  });

  it("normal PR merge needs no confirmation; admin merge does", async () => {
    vi.mocked(gh.prWrite).mockResolvedValue({ merged: true } as never);

    const normal = await executeGithubTool(USER, "github_pr_write", {
      repo: "o/r", action: "merge", number: 5,
    });
    expect((normal.result as Record<string, unknown>).merged).toBe(true);

    const admin = await executeGithubTool(USER, "github_pr_write", {
      repo: "o/r", action: "merge", number: 5, admin: true,
    });
    expect((admin.result as Record<string, unknown>).confirmationRequired).toBe(true);
    expect(gh.prWrite).toHaveBeenCalledTimes(1);
  });

  it("collaborator and secret-delete tools are confirmation-gated", async () => {
    for (const [tool, args] of [
      ["github_collaborator_write", { repo: "o/r", action: "add", username: "friend" }],
      ["github_secret_delete", { repo: "o/r", name: "DEPLOY_KEY" }],
    ] as const) {
      const out = await executeGithubTool(USER, tool, { ...args });
      expect((out.result as Record<string, unknown>).confirmationRequired).toBe(true);
    }
    expect(gh.collaboratorWrite).not.toHaveBeenCalled();
    expect(gh.secretDelete).not.toHaveBeenCalled();
  });
});

describe("unknown tools", () => {
  it("returns a validation error", async () => {
    const out = await executeGithubTool(USER, "github_nope", {});
    expect((out.result as Record<string, unknown>).category).toBe("VALIDATION_ERROR");
  });
});
