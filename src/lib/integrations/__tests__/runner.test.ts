import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RE,
  __setExecImplForTests,
  assertId,
  assertSafeArg,
  parseJson,
  runCli,
} from "../runner";
import { IntegrationError } from "../errors";

type ExecCall = {
  bin: string;
  args: string[];
  opts: { env: Record<string, string>; timeout: number; maxBuffer: number };
  stdin?: string;
};

let calls: ExecCall[] = [];

function mockExec(
  result: Partial<{ stdout: string; stderr: string; code: number; killed: boolean }> | Error
) {
  __setExecImplForTests(async (bin, args, opts, stdin) => {
    calls.push({ bin, args, opts: opts as never, stdin });
    if (result instanceof Error) throw result;
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      code: result.code ?? 0,
      killed: result.killed ?? false,
    };
  });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  __setExecImplForTests(null);
  vi.unstubAllEnvs();
});

describe("runCli", () => {
  it("rejects non-allowlisted binaries", async () => {
    await expect(
      runCli("bash" as never, ["-c", "echo hi"])
    ).rejects.toMatchObject({ category: "VALIDATION_ERROR" });
  });

  it("rejects arguments containing NUL bytes", async () => {
    mockExec({});
    await expect(runCli("gh", ["repo", "view", "a\0b"])).rejects.toMatchObject({
      category: "VALIDATION_ERROR",
    });
    expect(calls).toHaveLength(0);
  });

  it("builds a minimal child environment (no unrelated secrets)", async () => {
    vi.stubEnv("GH_TOKEN", "ghp_abcdefghijklmnopqrstuvwxyz123456");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-super-secret");
    vi.stubEnv("AUTH_SECRET", "hub-auth-secret");
    mockExec({ stdout: "ok" });
    await runCli("gh", ["--version"]);
    const env = calls[0].opts.env;
    expect(env.GH_TOKEN).toBe("ghp_abcdefghijklmnopqrstuvwxyz123456");
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.AUTH_SECRET).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("does not leak gh credentials to railway (and vice versa)", async () => {
    vi.stubEnv("GH_TOKEN", "ghp_abcdefghijklmnopqrstuvwxyz123456");
    vi.stubEnv("RAILWAY_TOKEN", "railway-tok");
    mockExec({ stdout: "" });
    await runCli("railway", ["--version"]);
    const env = calls[0].opts.env;
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.RAILWAY_TOKEN).toBe("railway-tok");
  });

  it("maps ENOENT to CLI_NOT_INSTALLED with a hint", async () => {
    mockExec(Object.assign(new Error("ENOENT"), { enoent: true }));
    try {
      await runCli("gh", ["--version"]);
      expect.unreachable();
    } catch (err) {
      const e = err as IntegrationError;
      expect(e.category).toBe("CLI_NOT_INSTALLED");
      expect(e.hint).toContain("cli.github.com");
    }
  });

  it("maps a killed process to TIMEOUT", async () => {
    mockExec({ killed: true });
    await expect(runCli("gh", ["run", "view"])).rejects.toMatchObject({
      category: "TIMEOUT",
    });
  });

  it("maps output-cap overflow to COMMAND_FAILED", async () => {
    mockExec(Object.assign(new Error("MAXBUFFER"), { maxbuffer: true }));
    await expect(runCli("gh", ["run", "view"])).rejects.toMatchObject({
      category: "COMMAND_FAILED",
    });
  });

  it("redacts stdout and stderr", async () => {
    mockExec({
      stdout: "token ghp_abcdefghijklmnopqrstuvwxyz123456 ok",
      stderr: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij",
      code: 1,
    });
    const res = await runCli("gh", ["auth", "status"]);
    expect(res.stdout).not.toContain("ghp_abcdefghijklmnopqrst");
    expect(res.stderr).not.toContain("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0");
    expect(res.exitCode).toBe(1);
  });

  it("passes stdin through (secret values never in argv)", async () => {
    mockExec({});
    await runCli("gh", ["secret", "set", "NAME", "-R", "o/r"], { stdin: "s3cret" });
    expect(calls[0].stdin).toBe("s3cret");
    expect(calls[0].args).not.toContain("s3cret");
  });
});

describe("assertId / assertSafeArg", () => {
  it("blocks flag injection via leading dash", () => {
    expect(() => assertId("-rf", RE.ghRepoName, "repo")).toThrowError(
      IntegrationError
    );
  });

  it("accepts valid identifiers", () => {
    expect(assertId("seed0001/my-hub", RE.ghRepoFull, "repo")).toBe("seed0001/my-hub");
    expect(assertId("feature/foo-1.2", RE.branch, "branch")).toBe("feature/foo-1.2");
  });

  it("rejects shell-metacharacter-shaped identifiers", () => {
    for (const bad of ["a;b", "a|b", "$(x)", "a b", "a`b`"]) {
      expect(() => assertId(bad, RE.ghRepoFull, "repo")).toThrow();
    }
  });

  it("bounds free-text argument length", () => {
    expect(() => assertSafeArg("x".repeat(20_001))).toThrow();
  });
});

describe("parseJson", () => {
  it("throws a categorized error on malformed output", () => {
    expect(() => parseJson("{not json", "list repos")).toThrowError(
      /malformed JSON/
    );
  });
});
