import * as rw from "./railway";
import { runGuarded, type GuardedOutcome } from "./guard";
import { toIntegrationError } from "./errors";

/**
 * Andrew's Railway tools. Same guard pipeline as GitHub: validation →
 * confirmation (for destructive / production-impacting / exposure-creating
 * actions) → audit.
 *
 * Defaults are read-only. Deploy-affecting writes that target a
 * production-named environment always demand confirmation, as do domain
 * changes (public exposure), variable overwrite/delete, service settings,
 * and every delete (which additionally requires confirmName).
 *
 * Not implemented on purpose: volume management (no safe non-interactive
 * interface) — documented in docs/INTEGRATIONS.md.
 */

export const RAILWAY_TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "railway_status",
      description:
        "Check the Railway integration: CLI installed/authenticated and whether the API token is configured. Use when Railway operations fail or before the first Railway action in a conversation.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_list_projects",
      description: "List Railway projects accessible to the configured account.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_project_view",
      description:
        "Get a Railway project's environments and services (ids + names). Use the ids with the other railway tools.",
      parameters: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_deployments",
      description:
        "List recent deployments for a project (optionally scoped to a service/environment) with status and ids.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          environmentId: { type: "string" },
          serviceId: { type: "string" },
          limit: { type: "integer", description: "Default 10, max 50" },
        },
        required: ["projectId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_deployment_view",
      description:
        "Get one deployment's current status by id. Deployments are asynchronous — poll with this tool instead of waiting; the id is stable.",
      parameters: {
        type: "object",
        properties: { deploymentId: { type: "string" } },
        required: ["deploymentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_logs",
      description:
        "Fetch bounded, sanitized build or deploy logs for a deployment (default 100 lines, max 500). Secrets and tokens are redacted.",
      parameters: {
        type: "object",
        properties: {
          deploymentId: { type: "string" },
          kind: { type: "string", enum: ["build", "deploy"] },
          lines: { type: "integer" },
        },
        required: ["deploymentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_variables",
      description:
        "List variable NAMES for a project environment (optionally a service). Values are never returned. To set a secret value, send the user to the Integrations sheet.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          environmentId: { type: "string" },
          serviceId: { type: "string" },
        },
        required: ["projectId", "environmentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_domains",
      description: "List service + custom domains for a service in an environment.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          environmentId: { type: "string" },
          serviceId: { type: "string" },
        },
        required: ["projectId", "environmentId", "serviceId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_create_project",
      description: "Create a new (empty) Railway project.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_service_create",
      description:
        "Create a service in a project, optionally linked to a GitHub repository (owner/repo) and branch. Linking a repo may trigger an initial deployment — say so before calling. Prefer Railway's existing GitHub auto-deploy on linked repos over manual redeploys.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          repo: { type: "string", description: "owner/repo to link (optional)" },
          branch: { type: "string" },
          name: { type: "string" },
        },
        required: ["projectId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_redeploy",
      description:
        "Redeploy a service in an environment. Production-named environments require the confirmation flow (call, relay summary, ask, call again with confirmationId). Returns immediately; poll railway_deployments / railway_deployment_view for status.",
      parameters: {
        type: "object",
        properties: {
          serviceId: { type: "string" },
          environmentId: { type: "string" },
          confirmationId: { type: "string" },
        },
        required: ["serviceId", "environmentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_deployment_cancel",
      description: "Cancel an in-progress deployment by id.",
      parameters: {
        type: "object",
        properties: { deploymentId: { type: "string" } },
        required: ["deploymentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_variable_write",
      description:
        "Set or delete a NON-SECRET environment variable. Overwriting an existing variable or deleting one requires the confirmation flow. Never pass secret values through this tool — the user sets those in the Integrations sheet.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["set", "delete"] },
          projectId: { type: "string" },
          environmentId: { type: "string" },
          serviceId: { type: "string" },
          name: { type: "string" },
          value: { type: "string" },
          confirmationId: { type: "string" },
        },
        required: ["action", "projectId", "environmentId", "name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_domain_write",
      description:
        "Generate a railway.app service domain or remove a service domain. Both directions use the confirmation flow (adding a domain exposes the service publicly).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["generate", "remove"] },
          environmentId: { type: "string" },
          serviceId: { type: "string" },
          domainId: { type: "string", description: "Required for remove" },
          confirmationId: { type: "string" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_service_settings",
      description:
        "Update service settings in an environment: sourceBranch, buildCommand, startCommand, healthcheckPath, restartPolicyType (ON_FAILURE|ALWAYS|NEVER). Always uses the confirmation flow; state the target service/environment first.",
      parameters: {
        type: "object",
        properties: {
          serviceId: { type: "string" },
          environmentId: { type: "string" },
          sourceBranch: { type: "string" },
          buildCommand: { type: "string" },
          startCommand: { type: "string" },
          healthcheckPath: { type: "string" },
          restartPolicyType: { type: "string", enum: ["ON_FAILURE", "ALWAYS", "NEVER"] },
          confirmationId: { type: "string" },
        },
        required: ["serviceId", "environmentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_delete_project",
      description:
        "PERMANENTLY delete a Railway project (all services, environments, deployments, data). confirmName must exactly repeat the project name; uses the confirmation flow.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          confirmName: { type: "string" },
          confirmationId: { type: "string" },
        },
        required: ["projectId", "confirmName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_delete_service",
      description:
        "PERMANENTLY delete a service. confirmName must exactly repeat the service name; uses the confirmation flow.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          serviceId: { type: "string" },
          confirmName: { type: "string" },
          confirmationId: { type: "string" },
        },
        required: ["projectId", "serviceId", "confirmName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "railway_delete_environment",
      description:
        "PERMANENTLY delete an environment. confirmName must exactly repeat the environment name; uses the confirmation flow.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          environmentId: { type: "string" },
          confirmName: { type: "string" },
          confirmationId: { type: "string" },
        },
        required: ["projectId", "environmentId", "confirmName"],
      },
    },
  },
] as const;

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : undefined);

export function isRailwayTool(name: string): boolean {
  return name.startsWith("railway_");
}

/** Resolve an environment's name for production checks / delete summaries. */
async function envNameSafe(environmentId: string | undefined): Promise<string> {
  if (!environmentId) return "";
  try {
    return await rw.environmentName(environmentId);
  } catch {
    // If the name can't be resolved, err on the cautious side.
    return "unknown (treat as production)";
  }
}

export async function executeRailwayTool(
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<GuardedOutcome> {
  switch (name) {
    case "railway_status":
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "READ", args,
        execute: async () => {
          const status = await rw.railwayStatus();
          return { result: status, label: `Railway: ${status.state}` };
        },
      });

    case "railway_list_projects":
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "READ", args,
        execute: async () => ({
          result: { projects: await rw.listProjects() },
          label: "Listed Railway projects",
        }),
      });

    case "railway_project_view":
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "READ", args,
        target: `project:${str(args.projectId)}`,
        execute: async () => ({
          result: await rw.projectView(str(args.projectId) ?? "") as unknown as Record<string, unknown>,
          label: "Viewed Railway project",
        }),
      });

    case "railway_deployments":
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "READ", args,
        target: `project:${str(args.projectId)}`,
        execute: async () => ({
          result: {
            deployments: await rw.listDeployments({
              projectId: str(args.projectId) ?? "",
              environmentId: str(args.environmentId),
              serviceId: str(args.serviceId),
              limit: num(args.limit),
            }),
          },
          label: "Listed deployments",
        }),
      });

    case "railway_deployment_view":
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "READ", args,
        target: `deployment:${str(args.deploymentId)}`,
        execute: async () => ({
          result: (await rw.deploymentView(str(args.deploymentId) ?? "")) as unknown as Record<string, unknown>,
          label: "Checked deployment status",
        }),
      });

    case "railway_logs":
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "READ", args,
        target: `deployment:${str(args.deploymentId)}`,
        execute: async () => ({
          result: await rw.deploymentLogs({
            deploymentId: str(args.deploymentId) ?? "",
            kind: str(args.kind) as never,
            lines: num(args.lines),
          }),
          label: `Fetched ${str(args.kind) || "deploy"} logs`,
        }),
      });

    case "railway_variables":
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "READ", args,
        target: `project:${str(args.projectId)}`,
        execute: async () => ({
          result: {
            names: await rw.variableNames({
              projectId: str(args.projectId) ?? "",
              environmentId: str(args.environmentId) ?? "",
              serviceId: str(args.serviceId),
            }),
            note: "Values are never shown. Secrets are set in the Integrations sheet.",
          },
          label: "Listed variable names",
        }),
      });

    case "railway_domains":
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "READ", args,
        target: `service:${str(args.serviceId)}`,
        execute: async () => ({
          result: (await rw.listDomains({
            projectId: str(args.projectId) ?? "",
            environmentId: str(args.environmentId) ?? "",
            serviceId: str(args.serviceId) ?? "",
          })) as unknown as Record<string, unknown>,
          label: "Listed domains",
        }),
      });

    case "railway_create_project":
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "WRITE", args,
        target: str(args.name),
        execute: async () => {
          const p = await rw.createProject(str(args.name) ?? "");
          return { result: p as unknown as Record<string, unknown>, label: `Created Railway project “${p.name}”` };
        },
      });

    case "railway_service_create":
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "WRITE", args,
        target: `project:${str(args.projectId)}${str(args.repo) ? ` repo:${str(args.repo)}` : ""}`,
        execute: async () => {
          const s = await rw.createService({
            projectId: str(args.projectId) ?? "",
            repo: str(args.repo),
            branch: str(args.branch),
            name: str(args.name),
          });
          return { result: s as unknown as Record<string, unknown>, label: `Created service “${s.name}”` };
        },
      });

    case "railway_redeploy": {
      const envName = await envNameSafe(str(args.environmentId));
      const production = rw.isProductionName(envName) || envName.startsWith("unknown");
      return runGuarded({
        userId, integration: "railway", tool: name, risk: production ? "DESTRUCTIVE" : "WRITE",
        args, target: `service:${str(args.serviceId)} env:${envName || str(args.environmentId)}`,
        confirm: production
          ? { summary: `Redeploy service ${str(args.serviceId)} in the ${envName || "unresolved"} environment. This replaces the running production deployment.` }
          : undefined,
        execute: async () => ({
          result: await rw.redeploy({
            serviceId: str(args.serviceId) ?? "",
            environmentId: str(args.environmentId) ?? "",
          }),
          label: `Redeployed service in ${envName || "environment"}`,
        }),
      });
    }

    case "railway_deployment_cancel":
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "WRITE", args,
        target: `deployment:${str(args.deploymentId)}`,
        execute: async () => ({
          result: await rw.cancelDeployment(str(args.deploymentId) ?? ""),
          label: "Cancelled deployment",
        }),
      });

    case "railway_variable_write": {
      const action = str(args.action);
      const varName = str(args.name) ?? "";
      const scope = {
        projectId: str(args.projectId) ?? "",
        environmentId: str(args.environmentId) ?? "",
        serviceId: str(args.serviceId),
      };
      if (action === "set") {
        // Overwriting an existing variable is high-risk; creating is a write.
        let exists = false;
        let envName = "";
        try {
          const [names, resolved] = await Promise.all([
            rw.variableNames(scope),
            envNameSafe(scope.environmentId),
          ]);
          exists = names.includes(varName);
          envName = resolved;
        } catch (err) {
          const e = toIntegrationError(err);
          return {
            result: { error: e.message, category: e.category, ...(e.hint ? { hint: e.hint } : {}) },
            label: `❌ ${name} failed (${e.category})`,
          };
        }
        return runGuarded({
          userId, integration: "railway", tool: name,
          risk: exists ? "DESTRUCTIVE" : "WRITE", args,
          target: `project:${scope.projectId} var:${varName}`,
          confirm: exists
            ? { summary: `OVERWRITE the existing Railway variable "${varName}" in ${envName || "this environment"}. The previous value is lost and dependent services may redeploy.` }
            : undefined,
          execute: async () => ({
            result: await rw.variableUpsert({ ...scope, name: varName, value: str(args.value) ?? "" }),
            label: `${exists ? "Overwrote" : "Set"} variable ${varName}`,
          }),
        });
      }
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "DESTRUCTIVE", args,
        target: `project:${scope.projectId} var:${varName}`,
        confirm: { summary: `DELETE the Railway variable "${varName}" from this environment. Services depending on it may fail until it is recreated.` },
        execute: async () => ({
          result: await rw.variableDelete({ ...scope, name: varName }),
          label: `Deleted variable ${varName}`,
        }),
      });
    }

    case "railway_domain_write": {
      const action = str(args.action);
      if (action === "generate")
        return runGuarded({
          userId, integration: "railway", tool: name, risk: "DESTRUCTIVE", args,
          target: `service:${str(args.serviceId)}`,
          confirm: { summary: `Generate a public railway.app domain for service ${str(args.serviceId)}. The service becomes publicly reachable.` },
          execute: async () => ({
            result: (await rw.domainCreate({
              environmentId: str(args.environmentId) ?? "",
              serviceId: str(args.serviceId) ?? "",
            })) as unknown as Record<string, unknown>,
            label: "Generated public domain",
          }),
        });
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "DESTRUCTIVE", args,
        target: `domain:${str(args.domainId)}`,
        confirm: { summary: `Remove domain ${str(args.domainId)}. Traffic to it stops immediately.` },
        execute: async () => ({
          result: await rw.domainDelete(str(args.domainId) ?? ""),
          label: "Removed domain",
        }),
      });
    }

    case "railway_service_settings": {
      const envName = await envNameSafe(str(args.environmentId));
      const settings: Record<string, string> = {};
      for (const k of ["sourceBranch", "buildCommand", "startCommand", "healthcheckPath", "restartPolicyType"] as const) {
        const v = str(args[k]);
        if (v !== undefined) settings[k] = v;
      }
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "DESTRUCTIVE", args,
        target: `service:${str(args.serviceId)} env:${envName || str(args.environmentId)}`,
        confirm: {
          summary: `Change service settings (${Object.keys(settings).join(", ") || "none"}) for service ${str(args.serviceId)} in ${envName || "this environment"}. May trigger a redeploy${rw.isProductionName(envName) ? " of PRODUCTION" : ""}.`,
        },
        execute: async () => ({
          result: await rw.updateServiceSettings({
            serviceId: str(args.serviceId) ?? "",
            environmentId: str(args.environmentId) ?? "",
            settings,
          }),
          label: `Updated service settings (${Object.keys(settings).join(", ")})`,
        }),
      });
    }

    case "railway_delete_project": {
      const projectId = str(args.projectId) ?? "";
      let projectName = "";
      try {
        projectName = (await rw.projectView(projectId)).name;
      } catch (err) {
        const e = toIntegrationError(err);
        return { result: { error: e.message, category: e.category }, label: `❌ ${name} failed (${e.category})` };
      }
      if (str(args.confirmName) !== projectName)
        return {
          result: {
            error: `confirmName must exactly equal the project name "${projectName}". Ask the user to type it to confirm.`,
            category: "VALIDATION_ERROR",
          },
          label: "⚠️ Project deletion blocked: confirmName mismatch",
        };
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "DESTRUCTIVE", args,
        target: `project:${projectId} (${projectName})`,
        confirm: { summary: `PERMANENTLY DELETE the Railway project "${projectName}" with all its services, environments, deployments, and data. This cannot be undone.` },
        execute: async () => ({
          result: await rw.deleteProject(projectId),
          label: `Deleted Railway project "${projectName}"`,
        }),
      });
    }

    case "railway_delete_service": {
      const projectId = str(args.projectId) ?? "";
      const serviceId = str(args.serviceId) ?? "";
      let serviceName = "";
      try {
        const project = await rw.projectView(projectId);
        serviceName = project.services.find((s) => s.id === serviceId)?.name ?? "";
      } catch (err) {
        const e = toIntegrationError(err);
        return { result: { error: e.message, category: e.category }, label: `❌ ${name} failed (${e.category})` };
      }
      if (!serviceName || str(args.confirmName) !== serviceName)
        return {
          result: {
            error: serviceName
              ? `confirmName must exactly equal the service name "${serviceName}".`
              : "Service not found in that project.",
            category: "VALIDATION_ERROR",
          },
          label: "⚠️ Service deletion blocked",
        };
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "DESTRUCTIVE", args,
        target: `service:${serviceId} (${serviceName})`,
        confirm: { summary: `PERMANENTLY DELETE the Railway service "${serviceName}" and its deployments. This cannot be undone.` },
        execute: async () => ({
          result: await rw.deleteService(serviceId),
          label: `Deleted service "${serviceName}"`,
        }),
      });
    }

    case "railway_delete_environment": {
      const projectId = str(args.projectId) ?? "";
      const environmentId = str(args.environmentId) ?? "";
      let envName = "";
      try {
        const project = await rw.projectView(projectId);
        envName = project.environments.find((e) => e.id === environmentId)?.name ?? "";
      } catch (err) {
        const e = toIntegrationError(err);
        return { result: { error: e.message, category: e.category }, label: `❌ ${name} failed (${e.category})` };
      }
      if (!envName || str(args.confirmName) !== envName)
        return {
          result: {
            error: envName
              ? `confirmName must exactly equal the environment name "${envName}".`
              : "Environment not found in that project.",
            category: "VALIDATION_ERROR",
          },
          label: "⚠️ Environment deletion blocked",
        };
      return runGuarded({
        userId, integration: "railway", tool: name, risk: "DESTRUCTIVE", args,
        target: `environment:${environmentId} (${envName})`,
        confirm: { summary: `PERMANENTLY DELETE the Railway environment "${envName}" and everything deployed in it. This cannot be undone.` },
        execute: async () => ({
          result: await rw.deleteEnvironment(environmentId),
          label: `Deleted environment "${envName}"`,
        }),
      });
    }

    default:
      return { result: { error: `Unknown Railway tool: ${name}`, category: "VALIDATION_ERROR" } };
  }
}
