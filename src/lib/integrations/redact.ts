/**
 * Redaction for anything produced by the integration layer: CLI stdout/stderr,
 * API responses, log excerpts, error messages. Applied before output reaches
 * the model, the audit log, the browser, or application logs.
 *
 * Patterns intentionally over-match: better to mask an id than leak a token.
 */

const PATTERNS: RegExp[] = [
  // GitHub tokens (classic + fine-grained + app/installation/refresh/server).
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,255}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g,
  // JWTs.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
  // Authorization headers.
  /\b(?:bearer|token|basic)\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
  // Generic long secrets in KEY=value / "key": "value" shapes.
  /((?:api[_-]?key|token|secret|password|passwd|credential|authorization)[a-z0-9_-]*["']?\s*[:=]\s*["']?)[^\s"'&]{6,}/gi,
  // Private key blocks.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

// Credentials embedded in URLs: scheme://user:pass@host
const URL_CREDS = /(\w+:\/\/)([^\s/:@]+):([^\s/@]+)@/g;

export function redact(input: string): string {
  if (!input) return input;
  let out = input;
  for (const re of PATTERNS) {
    out = out.replace(re, (m, prefix) =>
      typeof prefix === "string" && prefix.length < m.length
        ? `${prefix}[REDACTED]`
        : "[REDACTED]"
    );
  }
  out = out.replace(URL_CREDS, "$1[REDACTED]@");
  return out;
}

/** Redact every string value in a JSON-safe structure (shallow-to-deep). */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map(redactDeep) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Never pass through fields that are secret-valued by name.
      if (/^(?:token|secret|password|authorization|apiKey|api_key)$/i.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out as unknown as T;
  }
  return value;
}

/** Keep at most `max` characters, preferring the tail (where errors live). */
export function truncateTail(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return `…[truncated ${text.length - max} chars]…\n` + text.slice(-max);
}
