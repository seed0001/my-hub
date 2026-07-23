# Integrations implementation note (Pass 0)

Architecture and safety check for adding GitHub (`gh`) and Railway management
to Andrew, my-hub's assistant. Written before implementation; kept as a record
of the decisions.

## Existing architecture (findings)

- **Tools**: declared in OpenAI function-calling format in
  `src/lib/agentTools.ts` (`TOOL_DEFS`) and executed by `executeTool(userId,
  name, args)`, which returns `{ result, label?, refresh? }`. The agent loop in
  `src/app/api/chat/route.ts` streams OpenRouter responses, executes tool
  calls, and emits action-chip labels to the UI. Validation is hand-rolled
  (`str`/`num`/`bool` coercers) — there is no validation library; we follow
  that convention.
- **Persistence**: Prisma + Postgres (`prisma/schema.prisma`,
  `src/lib/db.ts`). Schema is synced with `prisma db push` on boot.
- **Server command execution**: none exists today. The only background work is
  the reminder dispatcher (`src/instrumentation.ts` →
  `src/lib/reminderDispatcher.ts`).
- **Confirmation flows**: prompt-level only ("Confirm with the user before
  calling this") — not adequate for the required security model, so a durable
  pending-action mechanism is added.
- **Checks**: `npm run lint`, `tsc --noEmit` (via `next build`), no test
  runner. Vitest is added for the integration layer.

## Files / components to change

| Area | Files |
|---|---|
| Schema | `prisma/schema.prisma`: `IntegrationLog`, `PendingAction` |
| Safety core | `src/lib/integrations/{errors,redact,runner,audit,confirm}.ts` |
| GitHub | `src/lib/integrations/github.ts` (adapter), `src/lib/integrations/githubTools.ts` (assistant tools) |
| Railway | `src/lib/integrations/railway.ts` (CLI + API adapter), `src/lib/integrations/railwayTools.ts` |
| Registration | `src/lib/agentTools.ts` merges integration tool defs + delegates execution |
| API | `src/app/api/integrations/{status,logs,diagnostics,secrets}/route.ts` |
| UI | `src/components/IntegrationsSheet.tsx`, header button in `Dashboard.tsx` |
| Prompt | `src/app/api/chat/route.ts` system-prompt additions |
| Tests | `vitest.config.ts`, `src/lib/integrations/__tests__/*` |
| Docs | `docs/INTEGRATIONS.md`, `README.md`, `.env.example` |

## Credential strategy

- GitHub: `GH_TOKEN` environment variable (fine-grained PAT, least privilege).
  Railway: `RAILWAY_TOKEN` (CLI account/project token) and `RAILWAY_API_TOKEN`
  (public GraphQL API), all server-side only.
- Child processes receive a **minimal constructed environment** (PATH, HOME,
  and only the credential variables the specific CLI needs) — never a full
  `process.env` passthrough.
- Tokens and secret values never appear in tool results, chat history, client
  payloads, audit rows, or diagnostics. All CLI/API output passes through a
  redaction filter before anything else sees it.
- Secret **values** are never accepted through chat (chat is persisted and
  model-visible). Setting a GitHub repo secret or a Railway secret variable
  happens only through the Integrations sheet, which POSTs directly to
  `/api/integrations/secrets`; the value is piped to the CLI via stdin (never
  argv) or sent directly in the API call, and only the secret *name* is
  logged.

## Command-execution boundary

- No shell, ever: `child_process.execFile` with argument arrays.
- Only two binaries are executable: `gh` and `railway`. Each adapter call uses
  a fixed subcommand template; identifiers (owner, repo, branch, run ids,
  Railway ids/names) are validated with strict regexes and may not begin with
  `-` (flag-injection guard). Free-text values (titles, bodies) are passed as
  argv values after a control-character check — safe without a shell.
- `gh api` is restricted to a fixed set of endpoint templates filled with
  validated identifiers; Andrew can never supply a raw endpoint.
- Timeouts (30s default, 60s for logs), output caps (2 MB), a small
  concurrency semaphore, and kill-on-timeout cancellation.
- JSON output requested wherever the CLI supports it (`--json`); results are
  normalized into typed objects before reaching the model.
- Retries: at most one, for **read** operations on transient failures only.
  Writes and destructive operations never auto-retry.

## Railway: CLI vs API

The Railway CLI is directory-context oriented and interactive for many
operations, and does not expose deployment inspection/cancellation
non-interactively. Per the requirements, the adapter uses the CLI for what it
supports non-interactively (version, whoami/auth check, project listing) and
Railway's documented public GraphQL API (`backboard.railway.com/graphql/v2`,
`RAILWAY_API_TOKEN`) behind the same typed adapter for: project/environment/
service details, deployments, bounded logs, redeploy/cancel, domains,
variables, service settings, and deletes. Each API-backed capability is
documented in `docs/INTEGRATIONS.md` with the reason.

## Confirmation model

`PendingAction` row binds: user id, exact tool name, SHA-256 of normalized
arguments (sorted keys, `confirmationId` excluded), a human impact summary,
and a 5-minute expiry. High-risk tools called without a `confirmationId`
create a pending action and return `CONFIRMATION_REQUIRED` with the summary —
they do not execute. Re-calling with the id + identical args consumes the row
atomically (single-use); any argument change, expiry, another user, or replay
invalidates it. Repository deletion additionally requires `confirmRepo` =
exact `owner/repo`; Railway deletes require `confirmName` = exact resource
name.

## Risk classes

- `READ` — inspection; no confirmation.
- `WRITE` — reversible creation/update; no confirmation.
- `DESTRUCTIVE` (and privilege/production/exposure-affecting writes) —
  dedicated tools + pending-action confirmation.

## Audit

Every attempted integration operation writes an `IntegrationLog` row:
timestamp, integration, tool, correlation id, user, sanitized target, risk
class, confirmation state, duration, outcome
(`SUCCESS|FAILURE|CANCELLED|BLOCKED`), sanitized error category + message.
Error categories: `CLI_NOT_INSTALLED`, `NOT_AUTHENTICATED`,
`PERMISSION_DENIED`, `VALIDATION_ERROR`, `CONFIRMATION_REQUIRED`,
`RATE_LIMITED`, `TIMEOUT`, `COMMAND_FAILED`, `API_ERROR`, `PARTIAL_FAILURE`.

## Proposed tool inventory

GitHub — read: `github_status`, `github_list_repos`, `github_repo_view`,
`github_repo_inspect` (branches/issues/prs/releases/runs/labels/milestones/
collaborators/environments/secret-names/variables), `github_run_view` (with
sanitized failed-log excerpt). Write: `github_create_repo`,
`github_update_repo` (description/homepage/topics/default branch),
`github_issue_write`, `github_pr_write` (admin-merge requires confirmation),
`github_release_write`, `github_meta_write` (labels/milestones),
`github_workflow_action`, `github_variable_write`. High-risk dedicated:
`github_delete_repo`, `github_set_visibility`, `github_archive_repo`,
`github_collaborator_write`, `github_secret_delete`. Branch-protection /
ruleset editing is intentionally **not implemented** (documented limitation).

Railway — read: `railway_status`, `railway_list_projects`,
`railway_project_view`, `railway_deployments`, `railway_deployment_view`,
`railway_logs` (bounded), `railway_variables` (names only). Write:
`railway_create_project`, `railway_service_create` (link GitHub repo),
`railway_redeploy` (production ⇒ confirmation), `railway_deployment_cancel`,
`railway_variable_write` (overwrite/delete ⇒ confirmation),
`railway_domain_write` (⇒ confirmation: public exposure),
`railway_service_settings` (⇒ confirmation). High-risk dedicated:
`railway_delete_project`, `railway_delete_service`,
`railway_delete_environment`. Volume management is intentionally **not
implemented** (documented limitation).

No architecture conflict was found that makes the requested security model
impossible; implementation proceeds without pausing for approval.
