import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../runner", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../runner")>();
  return { ...orig, runCli: vi.fn() };
});

import { runCli } from "../runner";
import * as gh from "../github";

const runCliMock = vi.mocked(runCli);

function cli(result: { stdout?: string; stderr?: string; exitCode?: number }) {
  runCliMock.mockResolvedValueOnce({
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.exitCode ?? 0,
  });
}

beforeEach(() => {
  runCliMock.mockReset();
});

describe("githubStatus", () => {
  it("reports connected with parsed version and account", async () => {
    cli({ stdout: "gh version 2.63.0 (2025-01-01)\n" });
    cli({ stdout: "github.com\n  ✓ Logged in to github.com account seed0001 (GH_TOKEN)\n" });
    const s = await gh.githubStatus();
    expect(s).toMatchObject({
      installed: true,
      version: "2.63.0",
      authenticated: true,
      account: "seed0001",
      state: "connected",
    });
  });

  it("reports unavailable when the CLI is missing", async () => {
    const { IntegrationError } = await import("../errors");
    runCliMock.mockRejectedValueOnce(
      new IntegrationError("CLI_NOT_INSTALLED", "The gh CLI is not installed on the server.")
    );
    const s = await gh.githubStatus();
    expect(s.installed).toBe(false);
    expect(s.state).toBe("unavailable");
  });

  it("reports disconnected when auth fails", async () => {
    cli({ stdout: "gh version 2.63.0\n" });
    cli({ exitCode: 1, stderr: "You are not logged into any GitHub hosts." });
    const s = await gh.githubStatus();
    expect(s.state).toBe("disconnected");
    expect(s.authenticated).toBe(false);
  });
});

describe("command construction", () => {
  it("listRepos builds a JSON list command with bounded limit", async () => {
    cli({ stdout: "[]" });
    await gh.listRepos({ owner: "seed0001", limit: 5000 });
    const [bin, args] = runCliMock.mock.calls[0];
    expect(bin).toBe("gh");
    expect(args.slice(0, 3)).toEqual(["repo", "list", "seed0001"]);
    expect(args).toContain("--json");
    const limit = Number(args[args.indexOf("--limit") + 1]);
    expect(limit).toBeLessThanOrEqual(100);
  });

  it("variable set sends the value via stdin, not argv", async () => {
    cli({});
    await gh.variableWrite({ repo: "o/r", action: "set", name: "MY_VAR", value: "hello" });
    const [, args, opts] = runCliMock.mock.calls[0];
    expect(args).not.toContain("hello");
    expect(opts?.stdin).toBe("hello");
  });

  it("visibility change includes the consequences-acknowledgement flag", async () => {
    cli({});
    await gh.setVisibility("o/r", "public");
    const [, args] = runCliMock.mock.calls[0];
    expect(args).toContain("--accept-visibility-change-consequences");
  });
});

describe("input validation", () => {
  it("rejects malformed repo identifiers", async () => {
    for (const bad of ["no-slash", "a/b;rm -rf", "-x/y", "a/b/c"]) {
      await expect(gh.repoView(bad)).rejects.toMatchObject({ category: "VALIDATION_ERROR" });
    }
    expect(runCliMock).not.toHaveBeenCalled();
  });

  it("rejects invalid visibility on create", async () => {
    await expect(
      gh.createRepo({ name: "x", visibility: "sneaky" as never })
    ).rejects.toMatchObject({ category: "VALIDATION_ERROR" });
  });

  it("refuses local-path sources when no workspace root is configured", () => {
    delete process.env.INTEGRATIONS_WORKSPACE_ROOT;
    expect(() => gh.resolveWorkspacePath("proj")).toThrowError(/disabled/);
  });
});

describe("error mapping", () => {
  it("maps HTTP 401 to NOT_AUTHENTICATED", async () => {
    cli({ exitCode: 1, stderr: "HTTP 401: Bad credentials" });
    await expect(gh.repoView("o/r")).rejects.toMatchObject({ category: "NOT_AUTHENTICATED" });
  });

  it("maps rate limiting to RATE_LIMITED", async () => {
    cli({ exitCode: 1, stderr: "HTTP 403: API rate limit exceeded for installation" });
    await expect(gh.repoView("o/r")).rejects.toMatchObject({ category: "RATE_LIMITED" });
  });

  it("maps 404 to PERMISSION_DENIED with hint", async () => {
    cli({ exitCode: 1, stderr: "HTTP 404: Not Found" });
    try {
      await gh.repoView("o/r");
      expect.unreachable();
    } catch (err) {
      const e = err as import("../errors").IntegrationError;
      expect(e.category).toBe("PERMISSION_DENIED");
      expect(e.hint).toBeTruthy();
    }
  });

  it("surfaces malformed JSON as COMMAND_FAILED", async () => {
    cli({ stdout: "{oops" });
    await expect(gh.repoView("o/r")).rejects.toMatchObject({ category: "COMMAND_FAILED" });
  });
});

describe("reads", () => {
  it("secret inspection returns names only", async () => {
    cli({
      stdout: JSON.stringify({
        secrets: [{ name: "DEPLOY_KEY", updated_at: "2026-01-01", value: "should-not-exist" }],
      }),
    });
    const out = (await gh.repoInspect({ repo: "o/r", what: "secrets" })) as Array<Record<string, unknown>>;
    expect(out[0]).toEqual({ name: "DEPLOY_KEY", updatedAt: "2026-01-01" });
  });

  it("failed-run log excerpts are redacted and bounded", async () => {
    cli({ stdout: JSON.stringify({ status: "completed", conclusion: "failure", jobs: [] }) });
    cli({ stdout: "x".repeat(10_000) + "\nerror: token ghp_abcdefghijklmnopqrstuvwxyz123456 leaked" });
    const res = (await gh.runView({ repo: "o/r", runId: 42, includeFailedLogs: true })) as {
      failedLogExcerpt: string;
    };
    expect(res.failedLogExcerpt).not.toContain("ghp_abcdefghijklmnopqrst");
    expect(res.failedLogExcerpt.length).toBeLessThan(5000);
  });
});
