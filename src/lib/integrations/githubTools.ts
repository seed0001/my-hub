import * as gh from "./github";
import { runGuarded, type GuardedOutcome } from "./guard";

/**
 * Andrew's GitHub tools: OpenAI function-calling definitions plus an executor
 * that routes through the guard (validation → confirmation → audit).
 *
 * High-risk operations are dedicated tools; repository deletion is never part
 * of a generic update call and demands the exact owner/repo be re-typed.
 */

export const GITHUB_TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "github_status",
      description:
        "Check the GitHub integration: CLI installed, version, and authenticated account. Use when GitHub operations fail or before the first GitHub action in a conversation.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "github_list_repos",
      description: "List repositories available to the authenticated GitHub account.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Filter to a user/org (default: the authenticated account)" },
          visibility: { type: "string", enum: ["public", "private", "internal"] },
          limit: { type: "integer", description: "Default 30, max 100" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_repo_view",
      description:
        "Get details for one repository: visibility, default branch, description, URLs, topics, archived state.",
      parameters: {
        type: "object",
        properties: { repo: { type: "string", description: "owner/repo" } },
        required: ["repo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_repo_inspect",
      description:
        "Inspect one aspect of a repository: branches, issues, prs, releases, runs (workflow runs), labels, milestones, collaborators, environments, secrets (names only — never values), or variables.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          what: {
            type: "string",
            enum: ["branches", "issues", "prs", "releases", "runs", "labels", "milestones", "collaborators", "environments", "secrets", "variables"],
          },
          state: { type: "string", enum: ["open", "closed", "merged", "all"], description: "For issues/prs" },
          limit: { type: "integer", description: "Default 20, max 100" },
        },
        required: ["repo", "what"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_run_view",
      description:
        "Get a workflow run's status and jobs, optionally with a sanitized excerpt of the failed-step logs.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          runId: { type: "integer" },
          includeFailedLogs: { type: "boolean" },
        },
        required: ["repo", "runId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_create_repo",
      description:
        "Create a new GitHub repository. visibility is REQUIRED — if the user hasn't said public or private, ask before calling. Returns the canonical URL and metadata. Does not push local files, add collaborators, create secrets, or deploy.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          owner: { type: "string", description: "User/org to create under (default: authenticated account). Ask if ambiguous." },
          visibility: { type: "string", enum: ["public", "private", "internal"] },
          description: { type: "string" },
          homepage: { type: "string" },
          addReadme: { type: "boolean" },
          gitignoreTemplate: { type: "string", description: "e.g. Node, Python" },
          license: { type: "string", description: "SPDX id, e.g. MIT" },
        },
        required: ["name", "visibility"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_update_repo",
      description:
        "Update repository description, homepage, topics, or default branch. Does NOT change visibility, archive, or delete — those have dedicated tools.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          description: { type: "string" },
          homepage: { type: "string" },
          defaultBranch: { type: "string" },
          addTopics: { type: "array", items: { type: "string" } },
          removeTopics: { type: "array", items: { type: "string" } },
        },
        required: ["repo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_issue_write",
      description: "Create, update, close, reopen, or comment on an issue.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          action: { type: "string", enum: ["create", "update", "close", "reopen", "comment"] },
          number: { type: "integer", description: "Required except for create" },
          title: { type: "string" },
          body: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
          assignees: { type: "array", items: { type: "string" } },
        },
        required: ["repo", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_pr_write",
      description:
        "Create, update, comment on, merge, or close a pull request. Normal merges respect required checks. Setting admin=true bypasses required checks and demands explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          action: { type: "string", enum: ["create", "update", "comment", "merge", "close"] },
          number: { type: "integer" },
          title: { type: "string" },
          body: { type: "string" },
          base: { type: "string" },
          head: { type: "string" },
          draft: { type: "boolean" },
          mergeStrategy: { type: "string", enum: ["merge", "squash", "rebase"] },
          admin: { type: "boolean", description: "Bypass required checks (high-risk, needs confirmation)" },
          confirmationId: { type: "string" },
        },
        required: ["repo", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_release_write",
      description: "Create or update a release for a tag.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          action: { type: "string", enum: ["create", "update"] },
          tag: { type: "string" },
          title: { type: "string" },
          notes: { type: "string" },
          draft: { type: "boolean" },
          prerelease: { type: "boolean" },
        },
        required: ["repo", "action", "tag"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_meta_write",
      description: "Create/update/delete labels, or create/update/close milestones.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          kind: { type: "string", enum: ["label", "milestone"] },
          action: { type: "string", enum: ["create", "update", "delete", "close"] },
          name: { type: "string", description: "Label name" },
          newName: { type: "string" },
          color: { type: "string", description: "6-digit hex, no #" },
          description: { type: "string" },
          number: { type: "integer", description: "Milestone number" },
          title: { type: "string", description: "Milestone title" },
          dueOn: { type: "string", description: "ISO 8601" },
        },
        required: ["repo", "kind", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_workflow_action",
      description: "Trigger a workflow (workflow_dispatch), or re-run / cancel a workflow run.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          action: { type: "string", enum: ["trigger", "rerun", "cancel"] },
          workflow: { type: "string", description: "Workflow file name or name (for trigger)" },
          ref: { type: "string" },
          runId: { type: "integer" },
          failedOnly: { type: "boolean", description: "Re-run failed jobs only" },
        },
        required: ["repo", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_variable_write",
      description:
        "Set or delete a repository Actions VARIABLE (non-secret). Secrets cannot be set via chat — direct the user to the Integrations sheet for secret values.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          action: { type: "string", enum: ["set", "delete"] },
          name: { type: "string" },
          value: { type: "string" },
        },
        required: ["repo", "action", "name"],
      },
    },
  },
  // --- High-risk, dedicated tools -----------------------------------------
  {
    type: "function",
    function: {
      name: "github_delete_repo",
      description:
        "PERMANENTLY delete a repository. Requires confirmRepo to exactly repeat owner/repo, and a confirmation flow: first call returns a confirmationId + impact summary; ask the user, then call again with the confirmationId.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          confirmRepo: { type: "string", description: "Must exactly equal repo" },
          confirmationId: { type: "string" },
        },
        required: ["repo", "confirmRepo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_set_visibility",
      description:
        "Change repository visibility (public/private/internal). High-risk: uses the confirmation flow (call, ask user, call again with confirmationId).",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          visibility: { type: "string", enum: ["public", "private", "internal"] },
          confirmationId: { type: "string" },
        },
        required: ["repo", "visibility"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_archive_repo",
      description: "Archive or unarchive a repository. High-risk: uses the confirmation flow.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          archived: { type: "boolean" },
          confirmationId: { type: "string" },
        },
        required: ["repo", "archived"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_collaborator_write",
      description:
        "Add or remove a repository collaborator (or change their permission by re-adding). High-risk: uses the confirmation flow.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          action: { type: "string", enum: ["add", "remove"] },
          username: { type: "string" },
          permission: { type: "string", enum: ["pull", "triage", "push", "maintain", "admin"] },
          confirmationId: { type: "string" },
        },
        required: ["repo", "action", "username"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_secret_delete",
      description:
        "Delete a repository Actions secret by name. High-risk: uses the confirmation flow. (Setting secret values is only possible in the Integrations sheet, never via chat.)",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          name: { type: "string" },
          confirmationId: { type: "string" },
        },
        required: ["repo", "name"],
      },
    },
  },
] as const;

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : undefined);
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
const strArr = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

export function isGithubTool(name: string): boolean {
  return name.startsWith("github_");
}

export async function executeGithubTool(
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<GuardedOutcome> {
  const repo = str(args.repo) ?? "";

  switch (name) {
    case "github_status":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "READ", args,
        execute: async () => {
          const status = await gh.githubStatus();
          return { result: status, label: `GitHub: ${status.state}` };
        },
      });

    case "github_list_repos":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "READ", args,
        target: str(args.owner),
        execute: async () => ({
          result: { repos: await gh.listRepos({ owner: str(args.owner), limit: num(args.limit), visibility: str(args.visibility) as never }) },
          label: "Listed GitHub repositories",
        }),
      });

    case "github_repo_view":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "READ", args, target: repo,
        execute: async () => ({ result: { repo: await gh.repoView(repo) }, label: `Viewed ${repo}` }),
      });

    case "github_repo_inspect":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "READ", args, target: repo,
        execute: async () => ({
          result: { items: await gh.repoInspect({ repo, what: str(args.what) as gh.InspectKind, state: str(args.state), limit: num(args.limit) }) },
          label: `Inspected ${str(args.what)} of ${repo}`,
        }),
      });

    case "github_run_view":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "READ", args, target: repo,
        execute: async () => ({
          result: await gh.runView({ repo, runId: num(args.runId) ?? 0, includeFailedLogs: bool(args.includeFailedLogs) }) as Record<string, unknown>,
          label: `Viewed run ${num(args.runId)} in ${repo}`,
        }),
      });

    case "github_create_repo": {
      const rname = str(args.name) ?? "";
      return runGuarded({
        userId, integration: "github", tool: name, risk: "WRITE", args,
        target: `${str(args.owner) ?? "(me)"}/${rname}`,
        execute: async () => {
          const res = await gh.createRepo({
            name: rname,
            owner: str(args.owner),
            visibility: str(args.visibility) as never,
            description: str(args.description),
            homepage: str(args.homepage),
            addReadme: bool(args.addReadme),
            gitignoreTemplate: str(args.gitignoreTemplate),
            license: str(args.license),
          });
          return { result: res, label: `Created repository ${res.nameWithOwner}` };
        },
      });
    }

    case "github_update_repo":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "WRITE", args, target: repo,
        execute: async () => {
          const res = await gh.updateRepo({
            repo,
            description: str(args.description),
            homepage: str(args.homepage),
            defaultBranch: str(args.defaultBranch),
            addTopics: strArr(args.addTopics),
            removeTopics: strArr(args.removeTopics),
          });
          return { result: res, label: `Updated ${repo} (${res.updated.join(", ")})` };
        },
      });

    case "github_issue_write": {
      const action = str(args.action) as gh.IssueAction;
      return runGuarded({
        userId, integration: "github", tool: name, risk: "WRITE", args, target: repo,
        execute: async () => ({
          result: (await gh.issueWrite({
            repo, action,
            number: num(args.number), title: str(args.title), body: str(args.body),
            labels: strArr(args.labels), assignees: strArr(args.assignees),
          })) as Record<string, unknown>,
          label: `Issue ${action} in ${repo}`,
        }),
      });
    }

    case "github_pr_write": {
      const action = str(args.action) as gh.PrAction;
      const admin = bool(args.admin) === true;
      const highRisk = action === "merge" && admin;
      return runGuarded({
        userId, integration: "github", tool: name, risk: highRisk ? "DESTRUCTIVE" : "WRITE",
        args, target: repo,
        confirm: highRisk
          ? { summary: `Merge PR #${num(args.number)} in ${repo} BYPASSING required status checks (--admin).` }
          : undefined,
        execute: async () => ({
          result: (await gh.prWrite({
            repo, action,
            number: num(args.number), title: str(args.title), body: str(args.body),
            base: str(args.base), head: str(args.head), draft: bool(args.draft),
            mergeStrategy: str(args.mergeStrategy) as never, admin,
          })) as Record<string, unknown>,
          label: `PR ${action} in ${repo}`,
        }),
      });
    }

    case "github_release_write":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "WRITE", args, target: repo,
        execute: async () => ({
          result: (await gh.releaseWrite({
            repo,
            action: str(args.action) as "create" | "update",
            tag: str(args.tag) ?? "", title: str(args.title), notes: str(args.notes),
            draft: bool(args.draft), prerelease: bool(args.prerelease),
          })) as Record<string, unknown>,
          label: `Release ${str(args.action)} ${str(args.tag)} in ${repo}`,
        }),
      });

    case "github_meta_write":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "WRITE", args, target: repo,
        execute: async () => ({
          result: (await gh.metaWrite({
            repo,
            kind: str(args.kind) as "label" | "milestone",
            action: str(args.action) as never,
            name: str(args.name), newName: str(args.newName), color: str(args.color),
            description: str(args.description), number: num(args.number),
            title: str(args.title), dueOn: str(args.dueOn),
          })) as Record<string, unknown>,
          label: `${str(args.kind)} ${str(args.action)} in ${repo}`,
        }),
      });

    case "github_workflow_action":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "WRITE", args, target: repo,
        execute: async () => ({
          result: (await gh.workflowAction({
            repo,
            action: str(args.action) as never,
            workflow: str(args.workflow), ref: str(args.ref),
            runId: num(args.runId), failedOnly: bool(args.failedOnly),
          })) as Record<string, unknown>,
          label: `Workflow ${str(args.action)} in ${repo}`,
        }),
      });

    case "github_variable_write":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "WRITE", args, target: repo,
        execute: async () => ({
          result: (await gh.variableWrite({
            repo,
            action: str(args.action) as "set" | "delete",
            name: str(args.name) ?? "", value: str(args.value),
          })) as Record<string, unknown>,
          label: `Variable ${str(args.action)} ${str(args.name)} in ${repo}`,
        }),
      });

    case "github_delete_repo": {
      if (!repo || str(args.confirmRepo) !== repo)
        return {
          result: {
            error: "confirmRepo must exactly repeat the owner/repo being deleted. Ask the user to type the full repository name to confirm.",
            category: "VALIDATION_ERROR",
          },
          label: "⚠️ Repo deletion blocked: confirmRepo mismatch",
        };
      return runGuarded({
        userId, integration: "github", tool: name, risk: "DESTRUCTIVE", args, target: repo,
        confirm: { summary: `PERMANENTLY DELETE the GitHub repository ${repo}. This cannot be undone; all issues, PRs, and history are lost.` },
        execute: async () => ({ result: await gh.deleteRepo(repo), label: `Deleted repository ${repo}` }),
      });
    }

    case "github_set_visibility":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "DESTRUCTIVE", args, target: repo,
        confirm: { summary: `Change visibility of ${repo} to ${str(args.visibility)}. ${str(args.visibility) === "public" ? "The code, issues, and history become publicly visible." : "This may cut off existing access (forks/stars are affected)."}` },
        execute: async () => ({
          result: await gh.setVisibility(repo, str(args.visibility) as never),
          label: `Set ${repo} visibility to ${str(args.visibility)}`,
        }),
      });

    case "github_archive_repo":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "DESTRUCTIVE", args, target: repo,
        confirm: { summary: `${bool(args.archived) ? "Archive" : "Unarchive"} ${repo}. ${bool(args.archived) ? "It becomes read-only." : "It becomes writable again."}` },
        execute: async () => ({
          result: await gh.archiveRepo(repo, bool(args.archived) ?? true),
          label: `${bool(args.archived) ? "Archived" : "Unarchived"} ${repo}`,
        }),
      });

    case "github_collaborator_write":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "DESTRUCTIVE", args, target: repo,
        confirm: {
          summary: str(args.action) === "add"
            ? `Give GitHub user "${str(args.username)}" ${str(args.permission) || "push"} access to ${repo}.`
            : `Remove GitHub user "${str(args.username)}" from ${repo}.`,
        },
        execute: async () => ({
          result: (await gh.collaboratorWrite({
            repo,
            action: str(args.action) as "add" | "remove",
            username: str(args.username) ?? "",
            permission: str(args.permission) as never,
          })) as Record<string, unknown>,
          label: `Collaborator ${str(args.action)}: ${str(args.username)} on ${repo}`,
        }),
      });

    case "github_secret_delete":
      return runGuarded({
        userId, integration: "github", tool: name, risk: "DESTRUCTIVE", args, target: repo,
        confirm: { summary: `Delete the Actions secret "${str(args.name)}" from ${repo}. Workflows depending on it will fail until it is recreated.` },
        execute: async () => ({
          result: await gh.secretDelete(repo, str(args.name) ?? ""),
          label: `Deleted secret ${str(args.name)} from ${repo}`,
        }),
      });

    default:
      return { result: { error: `Unknown GitHub tool: ${name}`, category: "VALIDATION_ERROR" } };
  }
}
