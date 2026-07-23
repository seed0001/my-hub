# GitHub & Railway integrations

Andrew (the my-hub assistant) can manage Travis's GitHub repositories and
Railway deployments through narrowly scoped, schema-validated tools. This
document covers setup, credentials, the tool inventory, safety boundaries,
and troubleshooting. The design rationale is in `INTEGRATIONS_PLAN.md`.

## Supported versions

| Tool | Minimum | Notes |
|---|---|---|
| GitHub CLI (`gh`) | 2.40+ (2.56+ recommended) | JSON output for list/view commands; `repo edit --accept-visibility-change-consequences` requires newer releases. |
| Railway CLI | 3.x+ | Used only for `--version`, `whoami`, and `list --json`; everything else uses the public API. |
| Railway public API | GraphQL v2 | `https://backboard.railway.com/graphql/v2` (override with `RAILWAY_API_URL`). |

`github_status` / `railway_status` report the installed versions so drift is
visible from the phone. **Note:** the Railway GraphQL query shapes are
centralized in `src/lib/integrations/railwayApi.ts` and were written against
the documented public API; they could not be live-verified from the
implementation environment (network egress to railway.com was blocked), so on
first deploy run a read-only check (`railway_list_projects`) and correct any
schema drift in that one file. Schema mismatches surface as structured
`API_ERROR` results, never crashes.

## Installation & authentication

### Local development

```bash
# GitHub CLI
brew install gh            # or see https://cli.github.com
gh auth login              # or export GH_TOKEN=...

# Railway CLI (optional if RAILWAY_API_TOKEN is set)
brew install railway       # or npm i -g @railway/cli
railway login              # or export RAILWAY_TOKEN=...
```

### Production (Railway deployment of my-hub)

The Nixpacks image does not include either CLI. Two options:

1. **API/token-only (recommended, no image changes):** set `GH_TOKEN` and
   `RAILWAY_API_TOKEN` as service variables. GitHub operations require the
   `gh` binary — add it via a Nixpacks package (`NIXPACKS_PKGS="gh"`), or
2. **Custom install step:** add `gh` (and optionally `railway`) in a
   `railway.json`/Nixpacks setup phase.

Without the `gh` binary, GitHub tools return `CLI_NOT_INSTALLED` with a hint;
without `RAILWAY_API_TOKEN`, Railway management tools return
`NOT_AUTHENTICATED`. The rest of my-hub is unaffected.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GH_TOKEN` | For GitHub tools | Fine-grained PAT. Least privilege: grant only the repositories Andrew should manage; add scopes only for features you use (e.g. `delete_repo` only if you want deletion possible at all). |
| `RAILWAY_API_TOKEN` | For Railway tools | Account/workspace token for the public GraphQL API (Railway → Account Settings → Tokens). |
| `RAILWAY_TOKEN` | Optional | Railway CLI auth (only `whoami`/`list` use the CLI). |
| `RAILWAY_API_URL` | Optional | Override the GraphQL endpoint. |
| `INTEGRATIONS_WORKSPACE_ROOT` | Optional | Absolute path enabling `gh repo create --source` from a local project. Unset = local-path operations disabled (default). Paths are realpath-checked to stay inside this root. |

Credentials live only in server env vars. Child processes receive a minimal
constructed environment (never a full `process.env`), CLI/API output passes a
redaction filter before anything reads it, and tokens never appear in tool
results, chat history, audit rows, client payloads, or diagnostics.

## Secret values

Secret **values** never transit chat — chat history is persisted and
model-visible. Setting a GitHub Actions secret or a Railway (secret) variable
happens in the **Integrations sheet** (plug icon in the header): the value
POSTs directly to `/api/integrations/secrets`, reaches `gh` via stdin (never
argv) or the Railway API request body, and only the secret *name* is audited.
Andrew can list secret names and delete secrets (with confirmation), but will
refuse secret values in chat and point to the sheet.

## Tool inventory

### GitHub

| Tool | Risk | Confirmation |
|---|---|---|
| `github_status`, `github_list_repos`, `github_repo_view`, `github_repo_inspect` (branches/issues/prs/releases/runs/labels/milestones/collaborators/environments/secret-names/variables), `github_run_view` | READ | — |
| `github_create_repo`, `github_update_repo`, `github_issue_write`, `github_pr_write` (normal), `github_release_write`, `github_meta_write`, `github_workflow_action`, `github_variable_write` | WRITE | — |
| `github_pr_write` with `admin: true` (bypass checks) | DESTRUCTIVE | ✔ |
| `github_delete_repo` | DESTRUCTIVE | ✔ + exact `confirmRepo` |
| `github_set_visibility`, `github_archive_repo`, `github_collaborator_write`, `github_secret_delete` | DESTRUCTIVE | ✔ |

Not implemented by design: branch-protection/ruleset editing, org/team
management, and secret **value** entry via tools.

### Railway

| Tool | Risk | Confirmation |
|---|---|---|
| `railway_status`, `railway_list_projects`, `railway_project_view`, `railway_deployments`, `railway_deployment_view`, `railway_logs` (≤500 lines, redacted), `railway_variables` (names only), `railway_domains` | READ | — |
| `railway_create_project`, `railway_service_create`, `railway_deployment_cancel`, `railway_redeploy` (non-production), `railway_variable_write` set of a *new* variable | WRITE | — |
| `railway_redeploy` targeting a production-named environment (or an unresolvable one — cautious default), `railway_variable_write` overwrite/delete, `railway_domain_write` (both directions), `railway_service_settings` | DESTRUCTIVE | ✔ |
| `railway_delete_project` / `railway_delete_service` / `railway_delete_environment` | DESTRUCTIVE | ✔ + exact `confirmName` |

Not implemented by design: volume management (no safe non-interactive
interface today) and anything relying on undocumented endpoints. Deployments
are asynchronous: tools return a stable deployment id immediately and Andrew
polls `railway_deployment_view`; no HTTP request is held open waiting.
Where a GitHub repo is already linked with Railway auto-deploy, pushing to the
branch remains the preferred deployment path — `railway_redeploy` is for
re-running the current build, not a parallel deploy mechanism.

### CLI vs API (Railway)

The Railway CLI is directory-context oriented and interactive for most
management operations; it exposes no non-interactive way to inspect
deployments, fetch bounded logs, cancel deployments, manage domains, or edit
service settings. Those use the documented public GraphQL API via
`railwayApi.ts`. The CLI is used where it works headlessly: `--version`,
`whoami` (status), and `list --json` (project listing fallback when no API
token is configured).

## Confirmation model

High-risk tools use a two-step, single-use flow:

1. First call → **no execution**; a `PendingAction` row is created bound to
   the user, the exact tool, and a SHA-256 of the normalized arguments; the
   tool returns `confirmationRequired` with an impact summary and
   `confirmationId` (expires in 5 minutes).
2. Andrew shows the summary; only after an explicit yes in the user's next
   message does it call the same tool with identical args + the id. The row is
   consumed atomically — changed arguments, expiry, replay, another user, or
   another tool all invalidate it.

Deletions additionally require re-typing the exact resource name
(`confirmRepo` = `owner/repo`, `confirmName` = project/service/environment
name).

## Audit log & diagnostics

Every attempted operation writes an `IntegrationLog` row: timestamp,
integration, tool, correlation id, user, sanitized target, risk class,
confirmation state, duration, outcome (`SUCCESS`/`FAILURE`/`CANCELLED`/
`BLOCKED`), and sanitized error category/message. Rows are kept indefinitely
(single-user hub; prune manually if it ever matters). The Integrations sheet
shows recent operations with GitHub/Railway filters and offers a copyable
sanitized diagnostic report (versions, states, recent error categories,
correlation ids — no credentials).

Error categories: `CLI_NOT_INSTALLED`, `NOT_AUTHENTICATED`,
`PERMISSION_DENIED`, `VALIDATION_ERROR`, `CONFIRMATION_REQUIRED`,
`RATE_LIMITED`, `TIMEOUT`, `COMMAND_FAILED`, `API_ERROR`, `PARTIAL_FAILURE`.

## Troubleshooting

| Symptom | Category | Fix |
|---|---|---|
| "CLI is not installed" | `CLI_NOT_INSTALLED` | Install `gh`/`railway` in the server image (see above). |
| "not authenticated" | `NOT_AUTHENTICATED` | Set/rotate `GH_TOKEN` / `RAILWAY_API_TOKEN`; check `gh auth status` locally. |
| "not found or lacks permission" | `PERMISSION_DENIED` | Check spelling and token scopes/repo access; for repo deletion the token needs `delete_repo`. |
| Rate limited | `RATE_LIMITED` | Wait; GitHub resets hourly, Railway per its published limits. |
| Slow/hanging CLI | `TIMEOUT` | Reads retry once automatically; check network/provider status. Writes never auto-retry. |
| "Railway API error — Unknown field" | `API_ERROR` | Public API schema drift — update the one query in `railwayApi.ts`. |
| Provider outage | `API_ERROR`/`COMMAND_FAILED` | Check githubstatus.com / status.railway.com; retry later. |

For bug reports, copy the diagnostic report from the Integrations sheet — the
correlation id links a chat error to its audit row.
