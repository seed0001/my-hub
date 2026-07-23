"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { timeAgo } from "@/lib/time";

interface CliStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  account: string | null;
  apiTokenConfigured?: boolean;
  state: "connected" | "degraded" | "disconnected" | "unavailable";
  detail: string;
}

interface StatusPayload {
  github: CliStatus;
  railway: CliStatus;
  checkedAt: string;
}

interface LogRow {
  id: string;
  integration: string;
  tool: string;
  correlationId: string;
  riskClass: string;
  target: string | null;
  outcome: string;
  errorCategory: string | null;
  durationMs: number;
  createdAt: string;
}

const STATE_STYLE: Record<CliStatus["state"], string> = {
  connected: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  degraded: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  disconnected: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  unavailable: "bg-red-500/15 text-red-300 border-red-500/40",
};

const OUTCOME_DOT: Record<string, string> = {
  SUCCESS: "bg-emerald-400",
  FAILURE: "bg-red-400",
  CANCELLED: "bg-amber-400",
  BLOCKED: "bg-amber-400",
};

export default function IntegrationsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [filter, setFilter] = useState<"all" | "github" | "railway">("all");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Secret form state — value lives only in this component until POSTed.
  const [secretOpen, setSecretOpen] = useState(false);
  const [secretIntegration, setSecretIntegration] = useState<"github" | "railway">("github");
  const [secretRepo, setSecretRepo] = useState("");
  const [secretProject, setSecretProject] = useState("");
  const [secretEnv, setSecretEnv] = useState("");
  const [secretService, setSecretService] = useState("");
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [secretBusy, setSecretBusy] = useState(false);
  const [secretMsg, setSecretMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      fetch("/api/integrations/status").then((r) => r.json()),
      fetch("/api/integrations/logs?limit=50").then((r) => r.json()),
    ])
      .then(([s, l]) => {
        setStatus(s);
        setLogs(l.logs || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  async function copyDiagnostics() {
    try {
      const res = await fetch("/api/integrations/diagnostics");
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — ignore.
    }
  }

  async function submitSecret() {
    setSecretBusy(true);
    setSecretMsg(null);
    try {
      const body: Record<string, string> = {
        integration: secretIntegration,
        name: secretName.trim(),
        value: secretValue,
      };
      if (secretIntegration === "github") body.repo = secretRepo.trim();
      else {
        body.projectId = secretProject.trim();
        body.environmentId = secretEnv.trim();
        if (secretService.trim()) body.serviceId = secretService.trim();
      }
      const res = await fetch("/api/integrations/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setSecretMsg("✓ Secret saved. The value was not stored anywhere in the hub.");
        setSecretValue("");
        setSecretName("");
      } else {
        setSecretMsg(`✕ ${data.error || "Failed to save secret."}`);
      }
    } catch {
      setSecretMsg("✕ Network error — secret not saved.");
    } finally {
      setSecretBusy(false);
    }
  }

  const filtered = filter === "all" ? logs : logs.filter((l) => l.integration === filter);

  return (
    <Modal open={open} onClose={onClose} title="Integrations">
      {loading ? (
        <p className="py-8 text-center text-sm text-hub-muted">Checking…</p>
      ) : (
        <div className="space-y-5">
          {/* Status cards */}
          <section className="space-y-2">
            {status &&
              (
                [
                  ["GitHub", status.github],
                  ["Railway", status.railway],
                ] as const
              ).map(([label, s]) => (
                <div
                  key={label}
                  className="rounded-lg border border-hub-border bg-hub-bg/40 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{label}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATE_STYLE[s.state]}`}
                    >
                      {s.state}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-hub-muted">
                    {s.installed ? `CLI v${s.version ?? "?"}` : "CLI not installed"}
                    {s.account ? ` · ${s.account}` : ""}
                    {label === "Railway" && s.apiTokenConfigured ? " · API token set" : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-hub-muted/80">{s.detail}</p>
                </div>
              ))}
            <button
              onClick={copyDiagnostics}
              className="w-full rounded-lg border border-hub-border px-3 py-2 text-xs font-medium text-hub-muted hover:text-white"
            >
              {copied ? "Copied ✓" : "Copy diagnostic report"}
            </button>
          </section>

          {/* Secret entry — the protected path; never via chat */}
          <section>
            <button
              onClick={() => setSecretOpen((v) => !v)}
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-hub-muted"
            >
              Set a secret {secretOpen ? "▾" : "▸"}
            </button>
            {secretOpen && (
              <div className="space-y-2 rounded-lg border border-hub-border bg-hub-bg/40 p-3">
                <p className="text-xs text-hub-muted">
                  Secret values entered here go straight to GitHub/Railway and are never
                  stored in the hub, shown to the assistant, or logged.
                </p>
                <div className="flex gap-2">
                  {(["github", "railway"] as const).map((i) => (
                    <button
                      key={i}
                      onClick={() => setSecretIntegration(i)}
                      className={`rounded-md border px-2.5 py-1 text-xs ${
                        secretIntegration === i
                          ? "border-hub-accent text-white"
                          : "border-hub-border text-hub-muted"
                      }`}
                    >
                      {i === "github" ? "GitHub repo secret" : "Railway variable"}
                    </button>
                  ))}
                </div>
                {secretIntegration === "github" ? (
                  <input
                    className="input w-full text-sm"
                    placeholder="owner/repo"
                    value={secretRepo}
                    onChange={(e) => setSecretRepo(e.target.value)}
                  />
                ) : (
                  <>
                    <input
                      className="input w-full text-sm"
                      placeholder="Project ID"
                      value={secretProject}
                      onChange={(e) => setSecretProject(e.target.value)}
                    />
                    <input
                      className="input w-full text-sm"
                      placeholder="Environment ID"
                      value={secretEnv}
                      onChange={(e) => setSecretEnv(e.target.value)}
                    />
                    <input
                      className="input w-full text-sm"
                      placeholder="Service ID (optional)"
                      value={secretService}
                      onChange={(e) => setSecretService(e.target.value)}
                    />
                  </>
                )}
                <input
                  className="input w-full text-sm"
                  placeholder="SECRET_NAME"
                  value={secretName}
                  onChange={(e) => setSecretName(e.target.value)}
                  autoCapitalize="characters"
                  autoCorrect="off"
                />
                <input
                  className="input w-full text-sm"
                  placeholder="Value"
                  type="password"
                  value={secretValue}
                  onChange={(e) => setSecretValue(e.target.value)}
                  autoComplete="off"
                />
                <button
                  onClick={submitSecret}
                  disabled={secretBusy || !secretName.trim() || !secretValue}
                  className="w-full rounded-lg bg-hub-accent/90 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {secretBusy ? "Saving…" : "Save secret"}
                </button>
                {secretMsg && <p className="text-xs text-hub-muted">{secretMsg}</p>}
              </div>
            )}
          </section>

          {/* Recent operations */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-hub-muted">
                Recent operations
              </h3>
              <div className="flex gap-1">
                {(["all", "github", "railway"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-md px-2 py-0.5 text-[11px] ${
                      filter === f ? "bg-hub-border text-white" : "text-hub-muted"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            {filtered.length === 0 ? (
              <p className="text-sm text-hub-muted">No operations yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {filtered.map((l) => (
                  <li
                    key={l.id}
                    className="rounded-lg border border-hub-border bg-hub-bg/40 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${OUTCOME_DOT[l.outcome] || "bg-hub-muted"}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {l.tool}
                        {l.target && (
                          <span className="text-hub-muted"> · {l.target}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] text-hub-muted">
                        {timeAgo(l.createdAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 pl-4 text-[11px] text-hub-muted">
                      {l.integration} · {l.riskClass.toLowerCase()} · {l.outcome.toLowerCase()}
                      {l.errorCategory ? ` · ${l.errorCategory}` : ""} · {l.durationMs}ms
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
