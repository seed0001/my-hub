import { describe, expect, it } from "vitest";
import { redact, redactDeep, truncateTail } from "../redact";

describe("redact", () => {
  it("masks GitHub tokens of every prefix", () => {
    for (const t of [
      "ghp_abcdefghijklmnopqrstuvwxyz123456",
      "gho_abcdefghijklmnopqrstuvwxyz123456",
      "ghs_abcdefghijklmnopqrstuvwxyz123456",
      "github_pat_11ABCDEFG_abcdefghijklmnopqrstuvwxyz",
    ]) {
      const out = redact(`token is ${t} here`);
      expect(out).not.toContain(t);
      expect(out).toContain("[REDACTED]");
    }
  });

  it("masks JWTs and bearer headers", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P";
    expect(redact(`Authorization: Bearer ${jwt}`)).not.toContain(jwt);
  });

  it("masks credentials embedded in URLs", () => {
    const out = redact("postgresql://hubuser:sup3rsecret@db.internal:5432/hub");
    expect(out).not.toContain("sup3rsecret");
    expect(out).toContain("[REDACTED]@db.internal");
  });

  it("masks KEY=value style secrets", () => {
    const out = redact("RAILWAY_TOKEN=c0ffee00-dead-beef-cafe-123456789abc rest");
    expect(out).not.toContain("c0ffee00-dead-beef-cafe-123456789abc");
  });

  it("leaves ordinary output alone", () => {
    const s = "Created repository travis/my-app (main) — 12 files";
    expect(redact(s)).toBe(s);
  });
});

describe("redactDeep", () => {
  it("redacts nested strings and secret-named fields", () => {
    const out = redactDeep({
      name: "ok",
      token: "plain-value-should-hide",
      nested: [{ note: "uses ghp_abcdefghijklmnopqrstuvwxyz123456" }],
    });
    expect(out.token).toBe("[REDACTED]");
    expect(JSON.stringify(out)).not.toContain("ghp_abcdefghijklmnopqrst");
  });
});

describe("truncateTail", () => {
  it("keeps the tail and notes the cut", () => {
    const out = truncateTail("a".repeat(50) + "TAIL", 10);
    expect(out).toContain("TAIL");
    expect(out).toContain("truncated");
    expect(out.length).toBeLessThan(80);
  });

  it("returns short strings unchanged", () => {
    expect(truncateTail("short", 100)).toBe("short");
  });
});
