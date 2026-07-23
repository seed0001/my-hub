import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./helpers/fakeDb";

vi.mock("@/lib/db", async () => {
  const { createFakeDb } = await import("./helpers/fakeDb");
  return { prisma: createFakeDb() };
});

import { prisma } from "@/lib/db";
import { newCorrelationId, recordAudit } from "../audit";

const db = prisma as unknown as FakeDb;

beforeEach(() => db.reset());

describe("recordAudit", () => {
  it("stores a complete sanitized row", async () => {
    const correlationId = newCorrelationId();
    await recordAudit({
      userId: "u1",
      integration: "github",
      tool: "github_delete_repo",
      correlationId,
      riskClass: "DESTRUCTIVE",
      target: "o/r",
      confirmation: "confirmed",
      outcome: "SUCCESS",
      durationMs: 123.7,
    });
    const row = db.integrationLog.rows[0];
    expect(row).toMatchObject({
      userId: "u1",
      integration: "github",
      tool: "github_delete_repo",
      correlationId,
      riskClass: "DESTRUCTIVE",
      target: "o/r",
      confirmation: "confirmed",
      outcome: "SUCCESS",
      durationMs: 124,
    });
  });

  it("redacts token-like content from target and error message", async () => {
    await recordAudit({
      userId: null,
      integration: "railway",
      tool: "railway_logs",
      correlationId: newCorrelationId(),
      riskClass: "READ",
      target: "deploy with ghp_abcdefghijklmnopqrstuvwxyz123456",
      confirmation: "not_required",
      outcome: "FAILURE",
      errorCategory: "COMMAND_FAILED",
      errorMessage: "failed: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij",
      durationMs: 10,
    });
    const row = db.integrationLog.rows[0];
    expect(String(row.target)).not.toContain("ghp_abcdefghijklmnopqrst");
    expect(String(row.errorMessage)).not.toContain("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0");
  });

  it("never throws even if the database write fails", async () => {
    const original = db.integrationLog.create;
    db.integrationLog.create = async () => {
      throw new Error("db down");
    };
    await expect(
      recordAudit({
        userId: "u1",
        integration: "github",
        tool: "t",
        correlationId: newCorrelationId(),
        riskClass: "READ",
        confirmation: "not_required",
        outcome: "SUCCESS",
        durationMs: 1,
      })
    ).resolves.toBeUndefined();
    db.integrationLog.create = original;
  });
});
