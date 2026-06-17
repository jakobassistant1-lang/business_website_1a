import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the DB so find-or-create can be unit-tested without Postgres.
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import {
  buildLoginAuthUrl,
  isGoogleAuthConfigured,
  signLoginState,
  verifyLoginState,
  exchangeLoginCode,
  fetchGoogleProfile,
  findOrCreateGoogleUser,
  type GoogleProfile,
} from "@/lib/googleAuth";

const findUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const create = prisma.user.create as unknown as ReturnType<typeof vi.fn>;

const verified: GoogleProfile = { sub: "g-123", email: "Stu@Example.com", emailVerified: true, name: "Stu Dent" };

describe("isGoogleAuthConfigured + buildLoginAuthUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is configured only when all three login vars are present", () => {
    vi.stubEnv("GOOGLE_AUTH_CLIENT_ID", "");
    expect(isGoogleAuthConfigured()).toBe(false);
    vi.stubEnv("GOOGLE_AUTH_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_AUTH_CLIENT_SECRET", "sec");
    vi.stubEnv("GOOGLE_AUTH_REDIRECT_URI", "https://app/cb");
    expect(isGoogleAuthConfigured()).toBe(true);
  });

  it("requests only the non-sensitive scopes and carries the state", () => {
    vi.stubEnv("GOOGLE_AUTH_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_AUTH_REDIRECT_URI", "https://app/cb");
    const url = buildLoginAuthUrl("st8");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("scope=openid+email+profile");
    expect(url).toContain("state=st8");
    expect(url).not.toContain("calendar"); // never a sensitive scope
  });
});

describe("login CSRF state (double-submit)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips a signed nonce", () => {
    vi.stubEnv("ENCRYPTION_KEY", "k");
    const state = signLoginState("nonceA");
    expect(state.startsWith("nonceA.")).toBe(true);
    expect(verifyLoginState(state, "nonceA")).toBe(true);
  });

  it("rejects a mismatched cookie nonce", () => {
    vi.stubEnv("ENCRYPTION_KEY", "k");
    expect(verifyLoginState(signLoginState("nonceA"), "other")).toBe(false);
  });

  it("rejects a tampered signature", () => {
    vi.stubEnv("ENCRYPTION_KEY", "k");
    expect(verifyLoginState("nonceA.deadbeef", "nonceA")).toBe(false);
  });

  it("rejects malformed state with no signature", () => {
    expect(verifyLoginState("garbage", "garbage")).toBe(false);
  });
});

describe("exchangeLoginCode + fetchGoogleProfile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns the access token from a code exchange", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ access_token: "AT" }) })));
    expect(await exchangeLoginCode("code")).toBe("AT");
  });

  it("throws on a failed exchange", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    await expect(exchangeLoginCode("bad")).rejects.toThrow();
  });

  it("parses a userinfo profile including email_verified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ sub: "1", email: "a@b.com", email_verified: true, name: "A B" }) })),
    );
    expect(await fetchGoogleProfile("AT")).toEqual({ sub: "1", email: "a@b.com", emailVerified: true, name: "A B" });
  });

  it("returns null when userinfo has no email", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ sub: "1" }) })));
    expect(await fetchGoogleProfile("AT")).toBeNull();
  });

  it("returns null when userinfo fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    expect(await fetchGoogleProfile("AT")).toBeNull();
  });
});

describe("findOrCreateGoogleUser (auto-link by verified email)", () => {
  beforeEach(() => {
    findUnique.mockReset();
    create.mockReset();
  });

  it("links to an existing account with the same (lowercased) email — no new account", async () => {
    const existing = { id: 7, email: "stu@example.com", password: "hash", isAdmin: false };
    findUnique.mockResolvedValue(existing);
    const u = await findOrCreateGoogleUser(verified);
    expect(u).toBe(existing);
    expect(findUnique).toHaveBeenCalledWith({ where: { email: "stu@example.com" } });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a passwordless, non-admin student when no account exists", async () => {
    findUnique.mockResolvedValue(null);
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 9, ...data }));
    const u = await findOrCreateGoogleUser(verified);
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.email).toBe("stu@example.com");
    expect(data.password).toBeNull();
    expect(data.isAdmin).toBe(false);
    expect(data.fullName).toBe("Stu Dent");
    expect(data.tosAcceptedAt).toBeInstanceOf(Date);
    expect(u.id).toBe(9);
  });

  it("refuses an unverified Google email (no DB touch)", async () => {
    await expect(findOrCreateGoogleUser({ ...verified, emailVerified: false })).rejects.toThrow();
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
