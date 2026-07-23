import { execFile } from "node:child_process";
import { IntegrationError } from "./errors";
import { redact, truncateTail } from "./redact";

/**
 * The single choke point through which every integration CLI invocation runs.
 *
 * Safety properties:
 * - No shell: `execFile` with an argument array; metacharacters are inert.
 * - Only allowlisted binaries (`gh`, `railway`) can run.
 * - Child processes get a minimal constructed environment — never a full
 *   `process.env` passthrough — with only the credential variables the
 *   specific CLI needs.
 * - Timeouts, output caps, and a small concurrency semaphore.
 * - All output is redacted before anyone else sees it.
 * - No automatic retries here; adapters may retry pure reads once.
 */

export type CliBinary = "gh" | "railway";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Piped to the child's stdin (used for secret values — never argv). */
  stdin?: string;
  /** Extra env vars for this call (merged onto the minimal base). */
  env?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT = 4;

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

/** Free-text argv values (titles, bodies): no NUL, bounded length. */
export function assertSafeArg(value: string, what = "argument"): string {
  if (typeof value !== "string")
    throw new IntegrationError("VALIDATION_ERROR", `${what} must be a string`);
  if (value.includes("\0"))
    throw new IntegrationError("VALIDATION_ERROR", `${what} contains a NUL byte`);
  if (value.length > 20_000)
    throw new IntegrationError("VALIDATION_ERROR", `${what} is too long`);
  return value;
}

/**
 * Identifiers that occupy positional/flag-value slots must match a strict
 * pattern and must not begin with "-" (flag injection).
 */
export function assertId(
  value: unknown,
  pattern: RegExp,
  what: string
): string {
  if (typeof value !== "string" || value.length === 0)
    throw new IntegrationError("VALIDATION_ERROR", `${what} is required`);
  if (value.startsWith("-"))
    throw new IntegrationError("VALIDATION_ERROR", `${what} may not start with "-"`);
  if (!pattern.test(value))
    throw new IntegrationError(
      "VALIDATION_ERROR",
      `${what} has an invalid format: ${JSON.stringify(value.slice(0, 60))}`
    );
  return value;
}

export const RE = {
  ghOwner: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,
  ghRepoName: /^[A-Za-z0-9._-]{1,100}$/,
  ghRepoFull: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/,
  branch: /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,254})$/,
  username: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,
  tagName: /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,254})$/,
  workflow: /^[A-Za-z0-9._ -]{1,200}$/,
  envVarName: /^[A-Za-z_][A-Za-z0-9_]{0,255}$/,
  railwayId: /^[A-Za-z0-9][A-Za-z0-9-]{5,63}$/,
  railwayName: /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/,
  labelName: /^[^\0\n-][^\0\n]{0,99}$/,
} as const;

// ---------------------------------------------------------------------------
// Minimal child environment
// ---------------------------------------------------------------------------

function baseEnv(bin: CliBinary): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME || "/tmp",
    NO_COLOR: "1",
    CLICOLOR: "0",
    TERM: "dumb",
    // Both CLIs treat CI as "never prompt".
    CI: "true",
  };
  if (process.env.HTTPS_PROXY) env.HTTPS_PROXY = process.env.HTTPS_PROXY;
  if (process.env.HTTP_PROXY) env.HTTP_PROXY = process.env.HTTP_PROXY;
  if (process.env.NO_PROXY) env.NO_PROXY = process.env.NO_PROXY;
  if (process.env.SSL_CERT_FILE) env.SSL_CERT_FILE = process.env.SSL_CERT_FILE;
  if (bin === "gh") {
    if (process.env.GH_TOKEN) env.GH_TOKEN = process.env.GH_TOKEN;
    else if (process.env.GITHUB_TOKEN) env.GH_TOKEN = process.env.GITHUB_TOKEN;
    env.GH_PROMPT_DISABLED = "1";
    env.GH_NO_UPDATE_NOTIFIER = "1";
    env.GH_PAGER = "cat";
  } else {
    if (process.env.RAILWAY_TOKEN) env.RAILWAY_TOKEN = process.env.RAILWAY_TOKEN;
    if (process.env.RAILWAY_API_TOKEN)
      env.RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN;
  }
  return env;
}

// ---------------------------------------------------------------------------
// Concurrency semaphore
// ---------------------------------------------------------------------------

let running = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  running++;
}

function release(): void {
  running--;
  const next = waiters.shift();
  if (next) next();
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

type ExecImpl = (
  bin: string,
  args: string[],
  opts: {
    timeout: number;
    maxBuffer: number;
    env: Record<string, string>;
    windowsHide: boolean;
    killSignal: NodeJS.Signals;
  },
  stdin: string | undefined
) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>;

const defaultExec: ExecImpl = (bin, args, opts, stdin) =>
  new Promise((resolve, reject) => {
    const execOpts = {
      ...opts,
      encoding: "utf8" as const,
      env: opts.env as NodeJS.ProcessEnv,
    };
    const child = execFile(bin, args, execOpts, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & {
          code?: number | string;
          killed?: boolean;
        };
        if (e.code === "ENOENT") {
          reject(Object.assign(new Error("ENOENT"), { enoent: true }));
          return;
        }
        if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          reject(Object.assign(new Error("MAXBUFFER"), { maxbuffer: true }));
          return;
        }
        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          code: typeof e.code === "number" ? e.code : 1,
          killed: Boolean(e.killed),
        });
        return;
      }
      resolve({
        stdout: String(stdout),
        stderr: String(stderr),
        code: 0,
        killed: false,
      });
    });
    if (stdin !== undefined && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });

let execImpl: ExecImpl = defaultExec;

/** Test hook: replace the process-execution implementation. */
export function __setExecImplForTests(impl: ExecImpl | null): void {
  execImpl = impl ?? defaultExec;
}

/**
 * Run an allowlisted CLI. Returns redacted stdout/stderr; throws
 * IntegrationError for structural failures (missing CLI, timeout, output cap).
 * Non-zero exits are returned (not thrown) so adapters can map them with
 * command-specific context.
 */
export async function runCli(
  bin: CliBinary,
  args: string[],
  opts: RunOptions = {}
): Promise<RunResult> {
  if (bin !== "gh" && bin !== "railway")
    throw new IntegrationError("VALIDATION_ERROR", `Binary not allowed: ${bin}`);
  for (const a of args) assertSafeArg(a);

  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = { ...baseEnv(bin), ...(opts.env || {}) };

  await acquire();
  try {
    const { stdout, stderr, code, killed } = await execImpl(
      bin,
      args,
      {
        timeout,
        maxBuffer: opts.maxOutputBytes ?? MAX_OUTPUT_BYTES,
        env,
        windowsHide: true,
        killSignal: "SIGKILL",
      },
      opts.stdin
    );
    if (killed)
      throw new IntegrationError(
        "TIMEOUT",
        `${bin} ${args[0] ?? ""} timed out after ${Math.round(timeout / 1000)}s`
      );
    return {
      stdout: redact(stdout),
      stderr: redact(truncateTail(stderr, 8000)),
      exitCode: code,
    };
  } catch (err) {
    if (err instanceof IntegrationError) throw err;
    const e = err as { enoent?: boolean; maxbuffer?: boolean };
    if (e.enoent)
      throw new IntegrationError(
        "CLI_NOT_INSTALLED",
        `The ${bin} CLI is not installed on the server.`,
        bin === "gh"
          ? "Install GitHub CLI (https://cli.github.com) in the server image."
          : "Install Railway CLI (https://docs.railway.com/guides/cli) in the server image."
      );
    if (e.maxbuffer)
      throw new IntegrationError(
        "COMMAND_FAILED",
        `${bin} produced more output than the safety cap allows.`
      );
    throw new IntegrationError("COMMAND_FAILED", redact(String(err)));
  } finally {
    release();
  }
}

/** Parse JSON stdout, throwing a categorized error on malformed output. */
export function parseJson<T>(stdout: string, context: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new IntegrationError(
      "COMMAND_FAILED",
      `${context}: CLI returned malformed JSON output.`
    );
  }
}
