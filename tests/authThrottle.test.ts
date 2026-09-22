// #128 — login throttle + signup / Google double-submit races. Routes are
// exercised directly with mocked DB / session / bcrypt. The shared limiter is a
// module-scope Map, so every case uses its own IPs and emails.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ createSession: vi.fn() }));
vi.mock("@/lib/password", () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(async () => "$hashed"),
  DUMMY_HASH: "$dummy-hash",
}));
vi.mock("@/lib/funnel", () => ({ logEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { verifyPassword, DUMMY_HASH } from "@/lib/password";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as forgot } from "@/app/api/auth/forgot-password/route";
import { findOrCreateGoogleUser } from "@/lib/googleAuth";
import { isUniqueViolation } from "@/lib/prismaErrors";

type Fn = ReturnType<typeof vi.fn>;
const findUnique = prisma.user.findUnique as unknown as Fn;
const create = prisma.user.create as unknown as Fn;
const vSession = createSession as unknown as Fn;
const vVerify = verifyPassword as unknown as Fn;

const TOO_MANY = /^Too many attempts\. Try again in \d+ minutes\.$/;
const expectTooMany = async (res: Response, maxRetrySec: number) => {
  expect(res.status).toBe(429);
  const body = await res.json();
  expect(Object.keys(body)).toEqual(["error"]);
  expect(body.error).toMatch(TOO_MANY);
  const retry = Number(res.headers.get("Retry-After"));
  expect(retry).toBeGreaterThan(0);
  expect(retry).toBeLessThanOrEqual(maxRetrySec);
  // The copy is built from the header: N = ceil(retryAfterSec / 60), min 1.
  expect(body.error).toBe(`Too many attempts. Try again in ${Math.max(1, Math.ceil(retry / 60))} minutes.`);
};
const P2002 = Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), {
  code: "P2002",
  meta: { target: ["email"] },
});

const post = (fn: (req: Request) => Promise<Response>, body: unknown, ip: string) =>
  fn(new Request("http://x/api/auth", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null);
  vVerify.mockResolvedValue(false);
});

describe("login: per-IP throttle (30 FAILURES per 15 min)", () => {
  it("30 failed attempts → 401 each; the 31st → 429 with Retry-After, before any DB lookup", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < 30; i++) {
      const res = await post(login, { email: `u${i}@ip.test`, password: "nope" }, ip);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Invalid credentials." });
    }
    expect(findUnique).toHaveBeenCalledTimes(30);

    const res = await post(login, { email: "u30@ip.test", password: "nope" }, ip);
    await expectTooMany(res, 15 * 60);
    expect(findUnique).toHaveBeenCalledTimes(30); // throttled before touching the DB
    expect(vSession).not.toHaveBeenCalled();
  });

  it("successful logins never count: 40 successes from one IP (a NAT'd dorm) all succeed", async () => {
    const ip = "203.0.113.11";
    findUnique.mockResolvedValue({ id: 1, email: "ok@ip.test", password: "$h", isAdmin: false });
    vVerify.mockResolvedValue(true);
    for (let i = 0; i < 40; i++) {
      const res = await post(login, { email: `ok${i}@ip.test`, password: "right" }, ip);
      expect(res.status).toBe(200);
    }
    expect(vSession).toHaveBeenCalledTimes(40);
  });

  it("a correct password after 29 failures from the same IP still succeeds (and does not add a hit)", async () => {
    const ip = "203.0.113.13";
    for (let i = 0; i < 29; i++) expect((await post(login, { email: `u${i}@ip.test`, password: "nope" }, ip)).status).toBe(401);
    findUnique.mockResolvedValue({ id: 1, email: "ok@ip.test", password: "$h", isAdmin: false });
    vVerify.mockResolvedValue(true);
    expect((await post(login, { email: "ok@ip.test", password: "right" }, ip)).status).toBe(200);
    expect((await post(login, { email: "ok@ip.test", password: "right" }, ip)).status).toBe(200);
    // One more failure is the 30th → still 401; the next attempt → 429.
    vVerify.mockResolvedValue(false);
    expect((await post(login, { email: "ok@ip.test", password: "wrong" }, ip)).status).toBe(401);
    expect((await post(login, { email: "ok@ip.test", password: "wrong" }, ip)).status).toBe(429);
  });

  it("other IPs are unaffected", async () => {
    const res = await post(login, { email: "someone@ip.test", password: "nope" }, "203.0.113.12");
    expect(res.status).toBe(401);
  });

  it("ipOf prefers x-real-ip over x-forwarded-for", async () => {
    let n = 0; // distinct email per attempt so only the IP bucket is in play
    const req = (real: string, xff: string) =>
      login(new Request("http://x/api/auth/login", { method: "POST", headers: { "x-real-ip": real, "x-forwarded-for": xff }, body: JSON.stringify({ email: `h${n++}@ip.test`, password: "nope" }) }));
    for (let i = 0; i < 30; i++) expect((await req("203.0.113.60", `203.0.113.${i}`)).status).toBe(401);
    expect((await req("203.0.113.60", "203.0.113.99")).status).toBe(429); // real-ip bucket is full...
    expect((await req("203.0.113.61", "203.0.113.60")).status).toBe(401); // ...xff alone doesn't match it
  });

  it("with no IP header at all the IP bucket is skipped (only the per-email bucket applies)", async () => {
    const req = (email: string) => login(new Request("http://x/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "nope" }) }));
    for (let i = 0; i < 35; i++) expect((await req(`noip${i}@host.test`)).status).toBe(401);
    expect(findUnique).toHaveBeenCalledTimes(35);
  });
});

describe("login: per-email throttle (20 FAILURES per hour, lowercased)", () => {
  const ips = ["198.51.100.1", "198.51.100.2", "198.51.100.3"];

  it("20 failures across several IPs → 401; the 21st attempt → 429 with the same message", async () => {
    for (let i = 0; i < 20; i++) {
      // Mixed case → one bucket; spread over IPs so the IP cap (30) never trips.
      const email = i % 2 ? "Victim@Email.test" : "victim@email.test";
      const res = await post(login, { email, password: "guess" }, ips[i % 3]);
      expect(res.status).toBe(401);
    }
    const res = await post(login, { email: "VICTIM@email.test", password: "guess" }, "198.51.100.4");
    await expectTooMany(res, 60 * 60);
    expect(findUnique).toHaveBeenCalledTimes(20); // the 21st never reached the DB
  });

  it("a correct password after 19 failures succeeds; success does not increment; the 21st failure → 429", async () => {
    const email = "owner@email.test";
    for (let i = 0; i < 19; i++) expect((await post(login, { email, password: "guess" }, ips[i % 3])).status).toBe(401);
    findUnique.mockResolvedValue({ id: 9, email, password: "$h", isAdmin: false });
    vVerify.mockResolvedValue(true);
    expect((await post(login, { email, password: "right" }, "198.51.100.5")).status).toBe(200);
    expect((await post(login, { email, password: "right" }, "198.51.100.5")).status).toBe(200);
    expect(vSession).toHaveBeenCalledTimes(2);
    vVerify.mockResolvedValue(false);
    expect((await post(login, { email, password: "wrong" }, "198.51.100.6")).status).toBe(401); // 20th failure
    const res = await post(login, { email, password: "wrong" }, "198.51.100.7"); // 21st → refused
    await expectTooMany(res, 60 * 60);
    expect(vSession).toHaveBeenCalledTimes(2);
  });

  it("once the email is over the cap even the RIGHT password is refused, with an identical 429 (no enumeration)", async () => {
    const ips2 = ["198.51.100.21", "198.51.100.22", "198.51.100.23"];
    for (let i = 0; i < 20; i++) await post(login, { email: "real@email.test", password: "guess" }, ips2[i % 3]);
    findUnique.mockResolvedValue({ id: 9, email: "real@email.test", password: "$h", isAdmin: false });
    vVerify.mockResolvedValue(true);
    const res = await post(login, { email: "real@email.test", password: "right" }, "198.51.100.24");
    await expectTooMany(res, 60 * 60);
    expect(vSession).not.toHaveBeenCalled();
  });

  it("a malformed email skips the email bucket (still 401, still constant-shape compare)", async () => {
    for (let i = 0; i < 25; i++) {
      const res = await post(login, { email: "not-an-email", password: "x" }, `198.51.100.${30 + (i % 3)}`);
      expect(res.status).toBe(401);
    }
    expect(vVerify).toHaveBeenCalledTimes(25);
  });
});

describe("login: constant-shape credential check", () => {
  it("runs bcrypt against the dummy hash when the email has no account", async () => {
    findUnique.mockResolvedValue(null);
    const res = await post(login, { email: "ghost@shape.test", password: "pw" }, "192.0.2.1");
    expect(res.status).toBe(401);
    expect(vVerify).toHaveBeenCalledWith("pw", DUMMY_HASH);
  });

  it("runs bcrypt against the dummy hash for a Google-only (passwordless) account and still refuses", async () => {
    findUnique.mockResolvedValue({ id: 2, email: "g@shape.test", password: null, isAdmin: false });
    vVerify.mockResolvedValue(true); // even a "match" against the dummy must not log in
    const res = await post(login, { email: "g@shape.test", password: "pw" }, "192.0.2.2");
    expect(res.status).toBe(401);
    expect(vVerify).toHaveBeenCalledWith("pw", DUMMY_HASH);
    expect(vSession).not.toHaveBeenCalled();
  });

  it("runs bcrypt against the stored hash for a password account", async () => {
    findUnique.mockResolvedValue({ id: 3, email: "p@shape.test", password: "$stored", isAdmin: false });
    vVerify.mockResolvedValue(true);
    const res = await post(login, { email: "p@shape.test", password: "pw" }, "192.0.2.3");
    expect(res.status).toBe(200);
    expect(vVerify).toHaveBeenCalledWith("pw", "$stored");
    expect(vSession).toHaveBeenCalledWith(3);
  });
});

describe("signup: double-submit race", () => {
  const body = { role: "student", email: "race@signup.test", password: "longenough", fullName: "Race Er", tosAccepted: true };

  it("P2002 on the email index → the same 409 as the pre-check, never a 500", async () => {
    findUnique.mockResolvedValue(null); // both submits pass the pre-check...
    create.mockRejectedValue(P2002); // ...the loser hits the unique index
    const res = await post(signup, body, "203.0.113.50");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ errors: { email: "An account with this email already exists." } });
    expect(vSession).not.toHaveBeenCalled();
  });

  it("the pre-check 409 is byte-identical to the race 409", async () => {
    findUnique.mockResolvedValue({ id: 5, email: body.email });
    const res = await post(signup, body, "203.0.113.51");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ errors: { email: "An account with this email already exists." } });
    expect(create).not.toHaveBeenCalled();
  });

  it("other DB errors still propagate (not swallowed as 409)", async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(new Error("connection lost"));
    await expect(post(signup, body, "203.0.113.52")).rejects.toThrow("connection lost");
  });

  it("happy path still creates the account and a session", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: 6 });
    const res = await post(signup, body, "203.0.113.53");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, isAdmin: false });
    expect(vSession).toHaveBeenCalledWith(6);
  });

  it("per-IP throttle still answers the unchanged 429 body (10 per 15 min)", async () => {
    const ip = "203.0.113.54";
    findUnique.mockResolvedValue({ id: 5, email: body.email }); // cheap 409s
    for (let i = 0; i < 10; i++) expect((await post(signup, body, ip)).status).toBe(409);
    const res = await post(signup, body, ip);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many sign-ups from here — try again in a few minutes." });
    expect(res.headers.get("Retry-After")).toBeNull(); // shape unchanged by the refactor
  });
});

describe("forgot-password: per-IP throttle parity after the refactor", () => {
  it("10 requests → { ok: true }; the 11th → the unchanged 429 body with no Retry-After", async () => {
    const ip = "203.0.113.70";
    findUnique.mockResolvedValue(null); // unknown email → nothing sent, same { ok: true }
    for (let i = 0; i < 10; i++) {
      const res = await post(forgot, { email: `who${i}@forgot.test` }, ip);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    const res = await post(forgot, { email: "who10@forgot.test" }, ip);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests — try again in a few minutes." });
    expect(res.headers.get("Retry-After")).toBeNull();
  });
});

describe("isUniqueViolation", () => {
  const p2002 = (meta?: unknown) => Object.assign(new Error("P2002"), { code: "P2002", ...(meta === undefined ? {} : { meta }) });

  it("array target containing the field", () => {
    expect(isUniqueViolation(p2002({ target: ["email"] }), "email")).toBe(true);
  });
  it("string target containing the field", () => {
    expect(isUniqueViolation(p2002({ target: "User_email_key" }), "email")).toBe(true);
  });
  it("missing meta with a field → false (never assumes which index)", () => {
    expect(isUniqueViolation(p2002(), "email")).toBe(false);
    expect(isUniqueViolation(p2002({}), "email")).toBe(false);
  });
  it("another field's index → false", () => {
    expect(isUniqueViolation(p2002({ target: ["stripeCustomerId"] }), "email")).toBe(false);
  });
  it("no field → any P2002 matches; non-P2002 / non-objects never do", () => {
    expect(isUniqueViolation(p2002(), undefined)).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error("x"), { code: "P2025" }))).toBe(false);
    expect(isUniqueViolation(new Error("plain"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("P2002")).toBe(false);
  });
});

describe("google find-or-create: two concurrent callbacks", () => {
  const profile = { sub: "g-1", email: "Race@Google.test", emailVerified: true, name: "Race Er" };

  it("P2002 → re-fetches the winner's row and returns it (idempotent, never throws)", async () => {
    const winner = { id: 7, email: "race@google.test", password: null, isAdmin: false };
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    create.mockRejectedValue(P2002);
    const user = await findOrCreateGoogleUser(profile);
    expect(user).toEqual(winner);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(findUnique).toHaveBeenLastCalledWith({ where: { email: "race@google.test" } });
  });

  it("other DB errors still propagate", async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(new Error("connection lost"));
    await expect(findOrCreateGoogleUser(profile)).rejects.toThrow("connection lost");
  });
});
