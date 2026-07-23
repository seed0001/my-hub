import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { IntegrationError } from "./errors";
import { redact, redactDeep, truncateTail } from "./redact";
import { RE, assertId, assertSafeArg, parseJson, runCli } from "./runner";

/**
 * Typed GitHub adapter over the `gh` CLI. Every operation is a fixed command
 * template; identifiers are validated before they reach argv. Raw CLI output
 * never leaves this module — results are normalized into plain objects and
 * redacted.
 *
 * Developed against gh >= 2.40 (JSON output for list/view commands,
 * `--accept-visibility-change-consequences` on `repo edit`). `githubStatus`
 * reports the installed version so drift is visible.
 */

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function mapGhFailure(context: string, stderr: string, exitCode: number): IntegrationError {
  const s = stderr.toLowerCase();
  if (
    s.includes("not logged in") ||
    s.includes("authentication required") ||
    s.includes("gh auth login") ||
    s.includes("bad credentials") ||
    s.includes("http 401")
  )
    return new IntegrationError(
      "NOT_AUTHENTICATED",
      `${context}: GitHub CLI is not authenticated.`,
      "Set GH_TOKEN on the server (fine-grained PAT with least privilege) or run `gh auth login` there."
    );
  if (s.includes("rate limit"))
    return new IntegrationError(
      "RATE_LIMITED",
      `${context}: GitHub API rate limit exceeded. Try again later.`
    );
  if (
    s.includes("http 403") ||
    s.includes("http 404") ||
    s.includes("not accessible") ||
    s.includes("could not resolve to a repository") ||
    s.includes("admin rights") ||
    s.includes("permission")
  )
    return new IntegrationError(
      "PERMISSION_DENIED",
      `${context}: the resource was not found or the token lacks permission for it.`,
      "Check the owner/repo spelling and the token's scopes."
    );
  if (s.includes("http 422") || s.includes("invalid"))
    return new IntegrationError(
      "VALIDATION_ERROR",
      `${context}: GitHub rejected the request — ${truncateTail(stderr.trim(), 300) || "invalid input"}`
    );
  return new IntegrationError(
    "COMMAND_FAILED",
    `${context}: gh exited with code ${exitCode}. ${truncateTail(stderr.trim(), 500)}`
  );
}

/** Run gh, throwing a mapped IntegrationError on non-zero exit. */
async function gh(
  context: string,
  args: string[],
  opts: { timeoutMs?: number; stdin?: string } = {}
): Promise<string> {
  const res = await runCli("gh", args, opts);
  if (res.exitCode !== 0) throw mapGhFailure(context, res.stderr || res.stdout, res.exitCode);
  return res.stdout;
}

/** One conservative retry for pure reads that hit a timeout. */
async function readWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof IntegrationError && err.category === "TIMEOUT") return await fn();
    throw err;
  }
}

function repoParts(repo: string): { owner: string; name: string } {
  assertId(repo, RE.ghRepoFull, "repository (owner/repo)");
  const [owner, name] = repo.split("/");
  return { owner, name };
}

/** gh api with fixed, validated endpoint templates only. */
async function ghApi<T>(
  context: string,
  path: string,
  opts: { method?: "GET" | "PUT" | "DELETE" | "POST" | "PATCH"; fields?: Record<string, string> } = {}
): Promise<T> {
  const args = ["api", path, "--header", "X-GitHub-Api-Version: 2022-11-28"];
  if (opts.method && opts.method !== "GET") args.push("--method", opts.method);
  for (const [k, v] of Object.entries(opts.fields || {})) {
    assertId(k, /^[A-Za-z_][A-Za-z0-9_]*$/, "api field name");
    args.push("-f", `${k}=${assertSafeArg(v, "api field value")}`);
  }
  const out = await gh(context, args);
  if (!out.trim()) return undefined as T;
  return parseJson<T>(out, context);
}

function intLimit(limit: unknown, def: number, max: number): number {
  const n = typeof limit === "number" && isFinite(limit) ? Math.floor(limit) : def;
  return Math.min(Math.max(n, 1), max);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface GithubStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  account: string | null;
  host: string;
  state: "connected" | "degraded" | "disconnected" | "unavailable";
  detail: string;
}

export async function githubStatus(): Promise<GithubStatus> {
  let version: string | null = null;
  try {
    const out = await runCli("gh", ["--version"], { timeoutMs: 10_000 });
    version = out.stdout.match(/gh version ([\d.]+)/)?.[1] ?? null;
    if (out.exitCode !== 0)
      return {
        installed: true,
        version,
        authenticated: false,
        account: null,
        host: "github.com",
        state: "degraded",
        detail: "gh is installed but `gh --version` failed.",
      };
  } catch (err) {
    const e = err as IntegrationError;
    return {
      installed: false,
      version: null,
      authenticated: false,
      account: null,
      host: "github.com",
      state: "unavailable",
      detail: e.message + (e.hint ? ` ${e.hint}` : ""),
    };
  }

  try {
    const res = await runCli("gh", ["auth", "status", "--hostname", "github.com"], {
      timeoutMs: 15_000,
    });
    const text = `${res.stdout}\n${res.stderr}`;
    if (res.exitCode === 0) {
      const account =
        text.match(/account ([A-Za-z0-9-]+)/)?.[1] ??
        text.match(/Logged in to \S+ as ([A-Za-z0-9-]+)/)?.[1] ??
        null;
      return {
        installed: true,
        version,
        authenticated: true,
        account,
        host: "github.com",
        state: "connected",
        detail: account ? `Authenticated as ${account}.` : "Authenticated.",
      };
    }
    return {
      installed: true,
      version,
      authenticated: false,
      account: null,
      host: "github.com",
      state: "disconnected",
      detail:
        "gh is installed but not authenticated. Set GH_TOKEN on the server (fine-grained PAT).",
    };
  } catch (err) {
    const e = err as IntegrationError;
    return {
      installed: true,
      version,
      authenticated: false,
      account: null,
      host: "github.com",
      state: "degraded",
      detail: e.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const REPO_LIST_FIELDS = "nameWithOwner,description,visibility,isArchived,updatedAt,url";
const REPO_VIEW_FIELDS =
  "nameWithOwner,description,homepageUrl,defaultBranchRef,visibility,isArchived,url,sshUrl,createdAt,pushedAt,repositoryTopics,stargazerCount";

export async function listRepos(params: {
  owner?: string;
  limit?: number;
  visibility?: "public" | "private" | "internal";
}) {
  const args = ["repo", "list"];
  if (params.owner) args.push(assertId(params.owner, RE.ghOwner, "owner"));
  args.push("--limit", String(intLimit(params.limit, 30, 100)), "--json", REPO_LIST_FIELDS);
  if (params.visibility) {
    if (!["public", "private", "internal"].includes(params.visibility))
      throw new IntegrationError("VALIDATION_ERROR", "visibility must be public, private, or internal");
    args.push("--visibility", params.visibility);
  }
  const out = await readWithRetry(() => gh("list repositories", args));
  return redactDeep(parseJson<unknown[]>(out, "list repositories"));
}

export async function repoView(repo: string) {
  repoParts(repo);
  const out = await readWithRetry(() =>
    gh("view repository", ["repo", "view", repo, "--json", REPO_VIEW_FIELDS])
  );
  return redactDeep(parseJson<Record<string, unknown>>(out, "view repository"));
}

export type InspectKind =
  | "branches"
  | "issues"
  | "prs"
  | "releases"
  | "runs"
  | "labels"
  | "milestones"
  | "collaborators"
  | "environments"
  | "secrets"
  | "variables";

export async function repoInspect(params: {
  repo: string;
  what: InspectKind;
  state?: string;
  limit?: number;
}): Promise<unknown> {
  const { repo } = params;
  const { owner, name } = repoParts(repo);
  const limit = intLimit(params.limit, 20, 100);
  const state = params.state && ["open", "closed", "merged", "all"].includes(params.state)
    ? params.state
    : "open";

  switch (params.what) {
    case "branches": {
      const rows = await readWithRetry(() =>
        ghApi<Array<{ name: string; protected: boolean }>>(
          "list branches",
          `repos/${owner}/${name}/branches?per_page=${limit}`
        )
      );
      return rows.map((b) => ({ name: b.name, protected: b.protected }));
    }
    case "issues": {
      const out = await readWithRetry(() =>
        gh("list issues", [
          "issue", "list", "-R", repo, "--state", state, "--limit", String(limit),
          "--json", "number,title,state,labels,assignees,updatedAt,url",
        ])
      );
      return redactDeep(parseJson<unknown[]>(out, "list issues"));
    }
    case "prs": {
      const out = await readWithRetry(() =>
        gh("list pull requests", [
          "pr", "list", "-R", repo, "--state", state, "--limit", String(limit),
          "--json", "number,title,state,isDraft,headRefName,baseRefName,updatedAt,url,author",
        ])
      );
      return redactDeep(parseJson<unknown[]>(out, "list pull requests"));
    }
    case "releases": {
      const rows = await readWithRetry(() =>
        ghApi<Array<Record<string, unknown>>>(
          "list releases",
          `repos/${owner}/${name}/releases?per_page=${limit}`
        )
      );
      return rows.map((r) => ({
        tag: r.tag_name, name: r.name, draft: r.draft,
        prerelease: r.prerelease, publishedAt: r.published_at, url: r.html_url,
      }));
    }
    case "runs": {
      const out = await readWithRetry(() =>
        gh("list workflow runs", [
          "run", "list", "-R", repo, "--limit", String(limit),
          "--json", "databaseId,displayTitle,status,conclusion,workflowName,headBranch,event,createdAt,url",
        ])
      );
      return redactDeep(parseJson<unknown[]>(out, "list workflow runs"));
    }
    case "labels": {
      const out = await readWithRetry(() =>
        gh("list labels", [
          "label", "list", "-R", repo, "--limit", String(limit),
          "--json", "name,color,description",
        ])
      );
      return redactDeep(parseJson<unknown[]>(out, "list labels"));
    }
    case "milestones": {
      const rows = await readWithRetry(() =>
        ghApi<Array<Record<string, unknown>>>(
          "list milestones",
          `repos/${owner}/${name}/milestones?state=all&per_page=${limit}`
        )
      );
      return rows.map((m) => ({
        number: m.number, title: m.title, state: m.state,
        dueOn: m.due_on, openIssues: m.open_issues, closedIssues: m.closed_issues,
      }));
    }
    case "collaborators": {
      const rows = await readWithRetry(() =>
        ghApi<Array<Record<string, unknown>>>(
          "list collaborators",
          `repos/${owner}/${name}/collaborators?per_page=${limit}`
        )
      );
      return rows.map((c) => ({ login: c.login, role: c.role_name }));
    }
    case "environments": {
      const res = await readWithRetry(() =>
        ghApi<{ environments?: Array<Record<string, unknown>> }>(
          "list environments",
          `repos/${owner}/${name}/environments`
        )
      );
      return (res.environments || []).map((e) => ({ name: e.name, url: e.html_url }));
    }
    case "secrets": {
      // Names and timestamps only — never values (GitHub never returns them,
      // and we would refuse to pass them through anyway).
      const res = await readWithRetry(() =>
        ghApi<{ secrets?: Array<Record<string, unknown>> }>(
          "list secret names",
          `repos/${owner}/${name}/actions/secrets?per_page=${limit}`
        )
      );
      return (res.secrets || []).map((s) => ({ name: s.name, updatedAt: s.updated_at }));
    }
    case "variables": {
      const res = await readWithRetry(() =>
        ghApi<{ variables?: Array<Record<string, unknown>> }>(
          "list variables",
          `repos/${owner}/${name}/actions/variables?per_page=${limit}`
        )
      );
      return redactDeep(
        (res.variables || []).map((v) => ({ name: v.name, value: v.value, updatedAt: v.updated_at }))
      );
    }
    default:
      throw new IntegrationError("VALIDATION_ERROR", `Unknown inspect kind: ${String(params.what)}`);
  }
}

export async function runView(params: {
  repo: string;
  runId: number;
  includeFailedLogs?: boolean;
}) {
  repoParts(params.repo);
  if (!Number.isInteger(params.runId) || params.runId <= 0)
    throw new IntegrationError("VALIDATION_ERROR", "runId must be a positive integer");
  const id = String(params.runId);
  const out = await readWithRetry(() =>
    gh("view workflow run", [
      "run", "view", id, "-R", params.repo,
      "--json", "status,conclusion,displayTitle,workflowName,url,jobs",
    ])
  );
  const run = parseJson<Record<string, unknown>>(out, "view workflow run");
  const jobs = Array.isArray(run.jobs)
    ? (run.jobs as Array<Record<string, unknown>>).map((j) => ({
        name: j.name, status: j.status, conclusion: j.conclusion,
      }))
    : [];
  let failedLogExcerpt: string | null = null;
  if (params.includeFailedLogs && run.conclusion === "failure") {
    try {
      const log = await gh(
        "fetch failed logs",
        ["run", "view", id, "-R", params.repo, "--log-failed"],
        { timeoutMs: 60_000 }
      );
      failedLogExcerpt = redact(truncateTail(log, 4000));
    } catch {
      failedLogExcerpt = "(failed to fetch logs — run may be too old or still in progress)";
    }
  }
  return redactDeep({
    status: run.status, conclusion: run.conclusion, title: run.displayTitle,
    workflow: run.workflowName, url: run.url, jobs, failedLogExcerpt,
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateRepoParams {
  name: string;
  owner?: string;
  visibility: "public" | "private" | "internal";
  description?: string;
  homepage?: string;
  addReadme?: boolean;
  gitignoreTemplate?: string;
  license?: string;
  sourcePath?: string;
  push?: boolean;
}

/** Resolve and containment-check a local path against the safe workspace. */
export function resolveWorkspacePath(p: string): string {
  const root = process.env.INTEGRATIONS_WORKSPACE_ROOT;
  if (!root)
    throw new IntegrationError(
      "VALIDATION_ERROR",
      "Local-repository operations are disabled: INTEGRATIONS_WORKSPACE_ROOT is not configured on the server."
    );
  const rootReal = realpathSync(resolve(root));
  let real: string;
  try {
    real = realpathSync(resolve(rootReal, p));
  } catch {
    throw new IntegrationError("VALIDATION_ERROR", `Path does not exist inside the workspace: ${p}`);
  }
  if (real !== rootReal && !real.startsWith(rootReal + sep))
    throw new IntegrationError(
      "VALIDATION_ERROR",
      "Path escapes the configured workspace root and was refused."
    );
  return real;
}

export async function createRepo(params: CreateRepoParams) {
  assertId(params.name, RE.ghRepoName, "repository name");
  if (!["public", "private", "internal"].includes(params.visibility))
    throw new IntegrationError("VALIDATION_ERROR", "visibility must be public, private, or internal");
  const full = params.owner
    ? `${assertId(params.owner, RE.ghOwner, "owner")}/${params.name}`
    : params.name;

  const args = ["repo", "create", full, `--${params.visibility}`];
  if (params.description) args.push("--description", assertSafeArg(params.description, "description"));
  if (params.homepage) args.push("--homepage", assertSafeArg(params.homepage, "homepage"));

  if (params.sourcePath) {
    const source = resolveWorkspacePath(params.sourcePath);
    args.push("--source", source);
    if (params.push) args.push("--push");
  } else {
    if (params.addReadme) args.push("--add-readme");
    if (params.gitignoreTemplate)
      args.push("--gitignore", assertId(params.gitignoreTemplate, /^[A-Za-z0-9.+_ -]{1,60}$/, "gitignore template"));
    if (params.license)
      args.push("--license", assertId(params.license, /^[A-Za-z0-9.+_-]{1,40}$/, "license"));
  }

  await gh("create repository", args, { timeoutMs: 60_000 });

  // Fetch canonical metadata for the result (never trust decorative output).
  const owner = params.owner || null;
  const viewTarget = owner ? `${owner}/${params.name}` : params.name;
  try {
    const view = (await repoView(
      owner ? viewTarget : ((await ghApi<{ login: string }>("get login", "user")).login + "/" + params.name)
    )) as Record<string, unknown>;
    const ref = view.defaultBranchRef as { name?: string } | null;
    return {
      created: true,
      nameWithOwner: view.nameWithOwner,
      url: view.url,
      sshUrl: view.sshUrl,
      defaultBranch: ref?.name ?? null,
      visibility: view.visibility,
    };
  } catch {
    return { created: true, nameWithOwner: viewTarget, url: null, sshUrl: null, defaultBranch: null, visibility: params.visibility };
  }
}

export async function updateRepo(params: {
  repo: string;
  description?: string;
  homepage?: string;
  defaultBranch?: string;
  addTopics?: string[];
  removeTopics?: string[];
}) {
  repoParts(params.repo);
  const args = ["repo", "edit", params.repo];
  const changed: string[] = [];
  if (params.description !== undefined) {
    args.push("--description", assertSafeArg(params.description, "description"));
    changed.push("description");
  }
  if (params.homepage !== undefined) {
    args.push("--homepage", assertSafeArg(params.homepage, "homepage"));
    changed.push("homepage");
  }
  if (params.defaultBranch) {
    args.push("--default-branch", assertId(params.defaultBranch, RE.branch, "default branch"));
    changed.push("default branch");
  }
  for (const t of params.addTopics || []) {
    args.push("--add-topic", assertId(t, /^[a-z0-9][a-z0-9-]{0,49}$/, "topic"));
    changed.push(`+topic:${t}`);
  }
  for (const t of params.removeTopics || []) {
    args.push("--remove-topic", assertId(t, /^[a-z0-9][a-z0-9-]{0,49}$/, "topic"));
    changed.push(`-topic:${t}`);
  }
  if (changed.length === 0)
    throw new IntegrationError("VALIDATION_ERROR", "No fields to change were provided.");
  await gh("update repository", args);
  return { updated: changed };
}

export type IssueAction = "create" | "update" | "close" | "reopen" | "comment";

export async function issueWrite(params: {
  repo: string;
  action: IssueAction;
  number?: number;
  title?: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}) {
  repoParts(params.repo);
  const needsNumber = params.action !== "create";
  if (needsNumber && (!Number.isInteger(params.number) || params.number! <= 0))
    throw new IntegrationError("VALIDATION_ERROR", `issue number is required for action "${params.action}"`);
  const n = String(params.number ?? "");
  const labels = (params.labels || []).map((l) => assertId(l, RE.labelName, "label"));
  const assignees = (params.assignees || []).map((a) => assertId(a, RE.username, "assignee"));

  switch (params.action) {
    case "create": {
      if (!params.title)
        throw new IntegrationError("VALIDATION_ERROR", "title is required to create an issue");
      const args = ["issue", "create", "-R", params.repo,
        "--title", assertSafeArg(params.title, "title"),
        "--body", assertSafeArg(params.body || "", "body")];
      for (const l of labels) args.push("--label", l);
      for (const a of assignees) args.push("--assignee", a);
      const out = await gh("create issue", args);
      return { url: redact(out.trim().split("\n").pop() || "") };
    }
    case "update": {
      const args = ["issue", "edit", n, "-R", params.repo];
      if (params.title) args.push("--title", assertSafeArg(params.title, "title"));
      if (params.body !== undefined) args.push("--body", assertSafeArg(params.body, "body"));
      for (const l of labels) args.push("--add-label", l);
      for (const a of assignees) args.push("--add-assignee", a);
      await gh("update issue", args);
      return { updated: true };
    }
    case "close":
      await gh("close issue", ["issue", "close", n, "-R", params.repo]);
      return { closed: true };
    case "reopen":
      await gh("reopen issue", ["issue", "reopen", n, "-R", params.repo]);
      return { reopened: true };
    case "comment": {
      if (!params.body)
        throw new IntegrationError("VALIDATION_ERROR", "body is required to comment");
      await gh("comment on issue", ["issue", "comment", n, "-R", params.repo,
        "--body", assertSafeArg(params.body, "body")]);
      return { commented: true };
    }
  }
}

export type PrAction = "create" | "update" | "comment" | "merge" | "close";

export async function prWrite(params: {
  repo: string;
  action: PrAction;
  number?: number;
  title?: string;
  body?: string;
  base?: string;
  head?: string;
  draft?: boolean;
  mergeStrategy?: "merge" | "squash" | "rebase";
  admin?: boolean;
}) {
  repoParts(params.repo);
  const needsNumber = params.action !== "create";
  if (needsNumber && (!Number.isInteger(params.number) || params.number! <= 0))
    throw new IntegrationError("VALIDATION_ERROR", `PR number is required for action "${params.action}"`);
  const n = String(params.number ?? "");

  switch (params.action) {
    case "create": {
      if (!params.title || !params.head)
        throw new IntegrationError("VALIDATION_ERROR", "title and head branch are required to create a PR");
      const args = ["pr", "create", "-R", params.repo,
        "--title", assertSafeArg(params.title, "title"),
        "--body", assertSafeArg(params.body || "", "body"),
        "--head", assertId(params.head, RE.branch, "head branch")];
      if (params.base) args.push("--base", assertId(params.base, RE.branch, "base branch"));
      if (params.draft) args.push("--draft");
      const out = await gh("create pull request", args);
      return { url: redact(out.trim().split("\n").pop() || "") };
    }
    case "update": {
      const args = ["pr", "edit", n, "-R", params.repo];
      if (params.title) args.push("--title", assertSafeArg(params.title, "title"));
      if (params.body !== undefined) args.push("--body", assertSafeArg(params.body, "body"));
      if (params.base) args.push("--base", assertId(params.base, RE.branch, "base branch"));
      await gh("update pull request", args);
      return { updated: true };
    }
    case "comment": {
      if (!params.body)
        throw new IntegrationError("VALIDATION_ERROR", "body is required to comment");
      await gh("comment on pull request", ["pr", "comment", n, "-R", params.repo,
        "--body", assertSafeArg(params.body, "body")]);
      return { commented: true };
    }
    case "merge": {
      const strategy = params.mergeStrategy || "merge";
      if (!["merge", "squash", "rebase"].includes(strategy))
        throw new IntegrationError("VALIDATION_ERROR", "mergeStrategy must be merge, squash, or rebase");
      const args = ["pr", "merge", n, "-R", params.repo, `--${strategy}`];
      // --admin (bypass required checks) is only reachable through the
      // confirmation gate in githubTools.
      if (params.admin) args.push("--admin");
      await gh("merge pull request", args, { timeoutMs: 60_000 });
      return { merged: true, strategy, bypassedChecks: Boolean(params.admin) };
    }
    case "close":
      await gh("close pull request", ["pr", "close", n, "-R", params.repo]);
      return { closed: true };
  }
}

export async function releaseWrite(params: {
  repo: string;
  action: "create" | "update";
  tag: string;
  title?: string;
  notes?: string;
  draft?: boolean;
  prerelease?: boolean;
}) {
  repoParts(params.repo);
  assertId(params.tag, RE.tagName, "tag");
  if (params.action === "create") {
    const args = ["release", "create", params.tag, "-R", params.repo];
    if (params.title) args.push("--title", assertSafeArg(params.title, "title"));
    args.push("--notes", assertSafeArg(params.notes || "", "notes"));
    if (params.draft) args.push("--draft");
    if (params.prerelease) args.push("--prerelease");
    const out = await gh("create release", args, { timeoutMs: 60_000 });
    return { url: redact(out.trim().split("\n").pop() || "") };
  }
  const args = ["release", "edit", params.tag, "-R", params.repo];
  if (params.title) args.push("--title", assertSafeArg(params.title, "title"));
  if (params.notes !== undefined) args.push("--notes", assertSafeArg(params.notes, "notes"));
  if (params.draft !== undefined) args.push(`--draft=${params.draft}`);
  if (params.prerelease !== undefined) args.push(`--prerelease=${params.prerelease}`);
  await gh("update release", args);
  return { updated: true };
}

export async function metaWrite(params: {
  repo: string;
  kind: "label" | "milestone";
  action: "create" | "update" | "delete" | "close";
  name?: string;
  newName?: string;
  color?: string;
  description?: string;
  number?: number;
  title?: string;
  dueOn?: string;
}) {
  const { owner, name: repoName } = repoParts(params.repo);
  if (params.kind === "label") {
    const label = assertId(params.name, RE.labelName, "label name");
    switch (params.action) {
      case "create": {
        const args = ["label", "create", label, "-R", params.repo];
        if (params.color) args.push("--color", assertId(params.color, /^[0-9a-fA-F]{6}$/, "color (6-digit hex)"));
        if (params.description) args.push("--description", assertSafeArg(params.description, "description"));
        await gh("create label", args);
        return { created: label };
      }
      case "update": {
        const args = ["label", "edit", label, "-R", params.repo];
        if (params.newName) args.push("--name", assertId(params.newName, RE.labelName, "new label name"));
        if (params.color) args.push("--color", assertId(params.color, /^[0-9a-fA-F]{6}$/, "color (6-digit hex)"));
        if (params.description !== undefined) args.push("--description", assertSafeArg(params.description, "description"));
        await gh("update label", args);
        return { updated: label };
      }
      case "delete":
        await gh("delete label", ["label", "delete", label, "-R", params.repo, "--yes"]);
        return { deleted: label };
      default:
        throw new IntegrationError("VALIDATION_ERROR", `Unsupported label action: ${params.action}`);
    }
  }
  // Milestones via fixed API templates (no gh subcommand exists).
  switch (params.action) {
    case "create": {
      if (!params.title) throw new IntegrationError("VALIDATION_ERROR", "title is required");
      const fields: Record<string, string> = { title: params.title };
      if (params.description) fields.description = params.description;
      if (params.dueOn) fields.due_on = assertId(params.dueOn, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/, "dueOn (ISO 8601)");
      const res = await ghApi<{ number: number }>(
        "create milestone", `repos/${owner}/${repoName}/milestones`, { method: "POST", fields });
      return { created: res.number };
    }
    case "update":
    case "close": {
      if (!Number.isInteger(params.number) || params.number! <= 0)
        throw new IntegrationError("VALIDATION_ERROR", "milestone number is required");
      const fields: Record<string, string> = {};
      if (params.title) fields.title = params.title;
      if (params.description !== undefined) fields.description = params.description ?? "";
      if (params.action === "close") fields.state = "closed";
      await ghApi("update milestone",
        `repos/${owner}/${repoName}/milestones/${params.number}`, { method: "PATCH", fields });
      return { updated: params.number };
    }
    default:
      throw new IntegrationError("VALIDATION_ERROR", `Unsupported milestone action: ${params.action}`);
  }
}

export async function workflowAction(params: {
  repo: string;
  action: "trigger" | "rerun" | "cancel";
  workflow?: string;
  ref?: string;
  runId?: number;
  failedOnly?: boolean;
}) {
  repoParts(params.repo);
  switch (params.action) {
    case "trigger": {
      if (!params.workflow)
        throw new IntegrationError("VALIDATION_ERROR", "workflow (file name or name) is required to trigger");
      const args = ["workflow", "run", assertId(params.workflow, RE.workflow, "workflow"), "-R", params.repo];
      if (params.ref) args.push("--ref", assertId(params.ref, RE.branch, "ref"));
      await gh("trigger workflow", args);
      return { triggered: params.workflow };
    }
    case "rerun": {
      if (!Number.isInteger(params.runId) || params.runId! <= 0)
        throw new IntegrationError("VALIDATION_ERROR", "runId is required to rerun");
      const args = ["run", "rerun", String(params.runId), "-R", params.repo];
      if (params.failedOnly) args.push("--failed");
      await gh("rerun workflow run", args);
      return { rerun: params.runId };
    }
    case "cancel": {
      if (!Number.isInteger(params.runId) || params.runId! <= 0)
        throw new IntegrationError("VALIDATION_ERROR", "runId is required to cancel");
      await gh("cancel workflow run", ["run", "cancel", String(params.runId), "-R", params.repo]);
      return { cancelled: params.runId };
    }
  }
}

export async function variableWrite(params: {
  repo: string;
  action: "set" | "delete";
  name: string;
  value?: string;
}) {
  repoParts(params.repo);
  assertId(params.name, RE.envVarName, "variable name");
  if (params.action === "set") {
    if (params.value === undefined)
      throw new IntegrationError("VALIDATION_ERROR", "value is required to set a variable");
    // Value via stdin so it never appears in a process list.
    await gh("set repository variable",
      ["variable", "set", params.name, "-R", params.repo],
      { stdin: assertSafeArg(params.value, "value") });
    return { set: params.name };
  }
  await gh("delete repository variable", ["variable", "delete", params.name, "-R", params.repo]);
  return { deleted: params.name };
}

// ---------------------------------------------------------------------------
// High-risk operations (only reachable through the confirmation gate)
// ---------------------------------------------------------------------------

export async function deleteRepo(repo: string) {
  repoParts(repo);
  await gh("delete repository", ["repo", "delete", repo, "--yes"], { timeoutMs: 60_000 });
  return { deleted: repo };
}

export async function setVisibility(repo: string, visibility: "public" | "private" | "internal") {
  repoParts(repo);
  if (!["public", "private", "internal"].includes(visibility))
    throw new IntegrationError("VALIDATION_ERROR", "visibility must be public, private, or internal");
  await gh("change repository visibility", [
    "repo", "edit", repo, "--visibility", visibility,
    "--accept-visibility-change-consequences",
  ]);
  return { repo, visibility };
}

export async function archiveRepo(repo: string, archived: boolean) {
  repoParts(repo);
  await gh(archived ? "archive repository" : "unarchive repository",
    ["repo", archived ? "archive" : "unarchive", repo, "--yes"]);
  return { repo, archived };
}

export async function collaboratorWrite(params: {
  repo: string;
  action: "add" | "remove";
  username: string;
  permission?: "pull" | "triage" | "push" | "maintain" | "admin";
}) {
  const { owner, name } = repoParts(params.repo);
  assertId(params.username, RE.username, "username");
  if (params.action === "add") {
    const permission = params.permission || "push";
    if (!["pull", "triage", "push", "maintain", "admin"].includes(permission))
      throw new IntegrationError("VALIDATION_ERROR", "permission must be pull, triage, push, maintain, or admin");
    await ghApi("add collaborator",
      `repos/${owner}/${name}/collaborators/${params.username}`,
      { method: "PUT", fields: { permission } });
    return { added: params.username, permission };
  }
  await ghApi("remove collaborator",
    `repos/${owner}/${name}/collaborators/${params.username}`, { method: "DELETE" });
  return { removed: params.username };
}

export async function secretDelete(repo: string, secretName: string) {
  repoParts(repo);
  assertId(secretName, RE.envVarName, "secret name");
  await gh("delete secret", ["secret", "delete", secretName, "-R", repo]);
  return { deleted: secretName };
}

/**
 * Set a repo Actions secret. Only callable from the protected settings route —
 * never registered as an assistant tool, so the value cannot transit chat.
 * Value goes to gh via stdin (not argv).
 */
export async function secretSet(repo: string, secretName: string, value: string) {
  repoParts(repo);
  assertId(secretName, RE.envVarName, "secret name");
  if (!value) throw new IntegrationError("VALIDATION_ERROR", "secret value is required");
  await gh("set secret", ["secret", "set", secretName, "-R", repo], { stdin: value });
  return { set: secretName };
}
