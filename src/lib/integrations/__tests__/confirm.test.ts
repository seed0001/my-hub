import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./helpers/fakeDb";

vi.mock("@/lib/db", async () => {
  const { createFakeDb } = await import("./helpers/fakeDb");
  return { prisma: createFakeDb() };
});

import { prisma } from "@/lib/db";
import { checkConfirmation, hashArgs, normalizeArgs } from "../confirm";

const db = prisma as unknown as FakeDb;

const base = {
  userId: "user1",
  tool: "github_delete_repo",
  summary: "Delete o/r forever",
};
const args = { repo: "o/r", confirmRepo: "o/r" };

async function issue() {
  const res = await checkConfirmation({ ...base, args });
  if (res.status !== "pending") throw new Error("expected pending");
  return res.confirmationId;
}

beforeEach(() => db.reset());

describe("normalizeArgs", () => {
  it("is order-insensitive and excludes confirmationId", () => {
    const a = normalizeArgs({ b: 1, a: "x", confirmationId: "abc" });
    const b = normalizeArgs({ a: "x", b: 1 });
    expect(a).toBe(b);
    expect(hashArgs(a)).toBe(hashArgs(b));
  });

  it("hash changes when any argument changes", () => {
    expect(hashArgs(normalizeArgs({ repo: "o/r" }))).not.toBe(
      hashArgs(normalizeArgs({ repo: "o/r2" }))
    );
  });
});

describe("checkConfirmation", () => {
  it("returns pending (and does not confirm) when no id is supplied", async () => {
    const res = await checkConfirmation({ ...base, args });
    expect(res.status).toBe("pending");
    expect(db.pendingAction.rows).toHaveLength(1);
  });

  it("confirms with the same user, tool, and identical args", async () => {
    const id = await issue();
    const res = await checkConfirmation({ ...base, args, confirmationId: id });
    expect(res.status).toBe("confirmed");
  });

  it("rejects when any argument changed after issuance", async () => {
    const id = await issue();
    const res = await checkConfirmation({
      ...base,
      args: { repo: "o/other", confirmRepo: "o/other" },
      confirmationId: id,
    });
    expect(res.status).toBe("invalid");
    if (res.status === "invalid") expect(res.reason).toMatch(/arguments changed/i);
  });

  it("rejects another user's confirmation", async () => {
    const id = await issue();
    const res = await checkConfirmation({ ...base, userId: "intruder", args, confirmationId: id });
    expect(res.status).toBe("invalid");
  });

  it("rejects a different tool with the same confirmation", async () => {
    const id = await issue();
    const res = await checkConfirmation({ ...base, tool: "github_set_visibility", args, confirmationId: id });
    expect(res.status).toBe("invalid");
  });

  it("cannot be replayed after consumption", async () => {
    const id = await issue();
    expect((await checkConfirmation({ ...base, args, confirmationId: id })).status).toBe("confirmed");
    const replay = await checkConfirmation({ ...base, args, confirmationId: id });
    expect(replay.status).toBe("invalid");
    if (replay.status === "invalid") expect(replay.reason).toMatch(/already used/i);
  });

  it("rejects expired confirmations", async () => {
    const id = await issue();
    const row = db.pendingAction.rows.find((r) => r.id === id)!;
    row.expiresAt = new Date(Date.now() - 1000);
    const res = await checkConfirmation({ ...base, args, confirmationId: id });
    expect(res.status).toBe("invalid");
    if (res.status === "invalid") expect(res.reason).toMatch(/expired/i);
  });

  it("rejects unknown confirmation ids", async () => {
    const res = await checkConfirmation({ ...base, args, confirmationId: "nope" });
    expect(res.status).toBe("invalid");
  });
});
