import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB so the token logic can be unit-tested without Postgres.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    passwordResetToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { hashToken, createResetToken, consumeToken, RESET_TTL_MS } from "@/lib/passwordReset";

const deleteMany = prisma.passwordResetToken.deleteMany as unknown as ReturnType<typeof vi.fn>;
const create = prisma.passwordResetToken.create as unknown as ReturnType<typeof vi.fn>;
const findUnique = prisma.passwordResetToken.findUnique as unknown as ReturnType<typeof vi.fn>;
const updateMany = prisma.passwordResetToken.updateMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  deleteMany.mockReset().mockResolvedValue({ count: 0 });
  create.mockReset().mockResolvedValue({});
  findUnique.mockReset();
  updateMany.mockReset();
});

describe("hashToken", () => {
  it("is deterministic, 64-hex, and never equals the raw token", () => {
    const raw = "abc123";
    const h = hashToken(raw);
    expect(h).toBe(hashToken(raw)); // deterministic
    expect(h).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(h).not.toBe(raw); // hashed, not raw
  });
});

describe("createResetToken", () => {
  it("clears prior unused tokens, stores only the HASH, and returns the RAW token", async () => {
    const raw = await createResetToken(7);
    expect(raw).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 7, usedAt: null } });

    const data = create.mock.calls[0][0].data;
    expect(data.userId).toBe(7);
    expect(data.tokenHash).toBe(hashToken(raw)); // what's persisted is the hash...
    expect(data.tokenHash).not.toBe(raw); // ...never the raw token
    expect(data.expiresAt).toBeInstanceOf(Date);
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + RESET_TTL_MS + 1000);
  });
});

describe("consumeToken", () => {
  it("returns the userId and atomically claims a valid token", async () => {
    findUnique.mockResolvedValue({ id: 1, userId: 42, usedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    updateMany.mockResolvedValue({ count: 1 });

    expect(await consumeToken("raw")).toBe(42);
    const where = updateMany.mock.calls[0][0].where;
    expect(where.id).toBe(1);
    expect(where.usedAt).toBeNull(); // claim only succeeds if still unused...
    expect(where.expiresAt.gt).toBeInstanceOf(Date); // ...and unexpired
  });

  it("returns null for an unknown token (no claim attempted)", async () => {
    findUnique.mockResolvedValue(null);
    expect(await consumeToken("nope")).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("returns null for an already-used token (claim matches 0 rows)", async () => {
    findUnique.mockResolvedValue({ id: 1, userId: 42, usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    updateMany.mockResolvedValue({ count: 0 });
    expect(await consumeToken("raw")).toBeNull();
  });

  it("returns null for an expired token (claim matches 0 rows)", async () => {
    findUnique.mockResolvedValue({ id: 1, userId: 42, usedAt: null, expiresAt: new Date(Date.now() - 1000) });
    updateMany.mockResolvedValue({ count: 0 });
    expect(await consumeToken("raw")).toBeNull();
  });

  it("returns null for an empty token without touching the DB", async () => {
    expect(await consumeToken("")).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
