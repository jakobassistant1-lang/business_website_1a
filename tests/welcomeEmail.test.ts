// #50 / #121 (welcome half) — the welcome email: the pure builder's copy, the
// never-throws sender, and the wiring at BOTH signup doors. `@/lib/email` is
// mocked everywhere in this file, so no test can send a real message.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn(), create: vi.fn() } } }));
vi.mock("@/lib/auth", () => ({ createSession: vi.fn() }));
vi.mock("@/lib/password", () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(async () => "$hashed"),
  DUMMY_HASH: "$dummy-hash",
}));
vi.mock("@/lib/funnel", () => ({ logEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logEvent } from "@/lib/funnel";
import { welcomeEmail, sendWelcomeEmail, firstNameOf, WELCOME_SUBJECT } from "@/lib/welcomeEmail";
import { POST as signup } from "@/app/api/auth/signup/route";
import { findOrCreateGoogleUser } from "@/lib/googleAuth";

type Fn = ReturnType<typeof vi.fn>;
const findUnique = prisma.user.findUnique as unknown as Fn;
const create = prisma.user.create as unknown as Fn;
const send = sendEmail as unknown as Fn;
const log = logEvent as unknown as Fn;

const APP = "https://app.navolearning.test";
const P2002 = Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), {
  code: "P2002",
  meta: { target: ["email"] },
});

/** Let any pending microtasks settle (the send is awaited by callers since #111; kept as a belt-and-braces flush). */
const flush = () => new Promise((r) => setTimeout(r, 0));

const post = (body: unknown, ip: string) =>
  signup(new Request("http://x/api/auth/signup", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify(body) }));

const signupBody = (email: string) => ({ role: "student", email, password: "longenough", fullName: "Ada Lovelace", tosAccepted: true });

/** The one welcome message the mocked sender was handed. */
const sentWelcome = () => {
  const calls = send.mock.calls.filter((c) => (c[0] as { subject: string }).subject === WELCOME_SUBJECT);
  return calls.map((c) => c[0] as { to: string; subject: string; text: string; html?: string });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", APP);
  findUnique.mockResolvedValue(null);
  send.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("welcomeEmail — the pure builder", () => {
  const built = () => welcomeEmail({ firstName: "Ada", appUrl: APP });

  it("uses the agreed subject line", () => {
    expect(built().subject).toBe("Welcome to Navo — let's get your week planned");
    expect(WELCOME_SUBJECT).toBe(built().subject);
  });

  it("links to the app root at the configured appUrl (html + text), never a bare path", () => {
    const { html, text } = built();
    expect(text).toContain(`${APP}/`);
    expect(html).toContain(`href="${APP}/"`);
    expect(html).toContain("Finish setting up");
    expect(text).toContain("Finish setting up");
  });

  it("normalises a trailing slash on appUrl instead of emitting '//'", () => {
    const { html, text } = welcomeEmail({ firstName: "Ada", appUrl: `${APP}/` });
    expect(html).toContain(`href="${APP}/"`);
    expect(text).not.toContain(`${APP}//`);
  });

  it("greets by first name and covers the three setup steps", () => {
    const { text, html } = built();
    expect(text.startsWith("Hi Ada,")).toBe(true);
    for (const step of ["Finish the demo", "Connect Canvas with a token", "See your plan"]) {
      expect(text).toContain(step);
      expect(html).toContain(step);
    }
  });

  it("carries a support line and a transactional (no-unsubscribe) footer", () => {
    const { text, html } = built();
    expect(text).toContain("support@navolearning.com");
    expect(html).toContain("mailto:support@navolearning.com");
    expect(text).toContain("one-time message about your account");
    expect(text.toLowerCase()).not.toContain("unsubscribe");
    expect(html.toLowerCase()).not.toContain("unsubscribe");
  });

  it("ships a plain-text version alongside inline-styled html", () => {
    const { text, html } = built();
    expect(text.length).toBeGreaterThan(100);
    expect(text).not.toContain("<");
    expect(html).toContain("<a href=");
    expect(html).toContain("style=");
  });

  it("never implies Navo is free, and never names a price", () => {
    const { text, html } = built();
    for (const blob of [text, html]) {
      expect(blob.toLowerCase()).not.toMatch(/free\s+forever|forever\s+free|free\s+plan|no\s+credit\s+card/);
      expect(blob).not.toMatch(/\b4[.,]99\b/);
      expect(blob).not.toMatch(/\$\s?\d+(\.\d\d)?\s*(\/|per)\s*mo/i);
    }
  });
});

describe("firstNameOf — greeting fallback", () => {
  it("takes the first word of a full name", () => {
    expect(firstNameOf("Ada Lovelace")).toBe("Ada");
    expect(firstNameOf("  Grace   Hopper ")).toBe("Grace");
    expect(firstNameOf("Prince")).toBe("Prince");
  });
  it("falls back to 'there' for null, empty or whitespace-only names", () => {
    expect(firstNameOf(null)).toBe("there");
    expect(firstNameOf("")).toBe("there");
    expect(firstNameOf("   ")).toBe("there");
    expect(firstNameOf(undefined)).toBe("there");
  });
});

describe("sendWelcomeEmail — fire-and-forget", () => {
  it("sends to the account's address with the built subject, html and text", async () => {
    await sendWelcomeEmail({ id: 1, email: "ada@school.test", fullName: "Ada Lovelace" });
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0] as { to: string; subject: string; text: string; html: string };
    expect(msg.to).toBe("ada@school.test");
    expect(msg.subject).toBe(WELCOME_SUBJECT);
    expect(msg.text).toContain("Hi Ada,");
    expect(msg.html).toContain(`href="${APP}/"`);
  });

  it("greets a null-name account with 'there'", async () => {
    await sendWelcomeEmail({ id: 2, email: "anon@school.test", fullName: null });
    expect((send.mock.calls[0][0] as { text: string }).text.startsWith("Hi there,")).toBe(true);
  });

  it("logs welcome_sent only when the send reports ok", async () => {
    await sendWelcomeEmail({ id: 3, email: "ok@school.test", fullName: "Ok Person" });
    expect(log).toHaveBeenCalledWith("welcome_sent", 3);

    log.mockClear();
    send.mockResolvedValue({ ok: false });
    await sendWelcomeEmail({ id: 4, email: "bad@school.test", fullName: "No Send" });
    expect(log).not.toHaveBeenCalled();
  });

  it("swallows a thrown sendEmail — resolves, never rejects, logs nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValue(new Error("resend exploded"));
    await expect(sendWelcomeEmail({ id: 5, email: "boom@school.test", fullName: "Boom" })).resolves.toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("does nothing (and still never throws) without an address", async () => {
    await expect(sendWelcomeEmail({ id: 6, email: "", fullName: "No Address" })).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("signup route: exactly one welcome email per created account", () => {
  it("sends once on a successful create", async () => {
    create.mockResolvedValue({ id: 10, email: "new@signup.test", fullName: "Ada Lovelace" });
    const res = await post(signupBody("new@signup.test"), "203.0.113.150");
    expect(res.status).toBe(200);
    await flush();
    expect(sentWelcome()).toHaveLength(1);
    expect(sentWelcome()[0].to).toBe("new@signup.test");
    expect(sentWelcome()[0].text).toContain("Hi Ada,");
  });

  it("sends nothing on the pre-check 409 (email already registered)", async () => {
    findUnique.mockResolvedValue({ id: 11, email: "dupe@signup.test", fullName: "Dupe" });
    const res = await post(signupBody("dupe@signup.test"), "203.0.113.151");
    expect(res.status).toBe(409);
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("sends nothing to the loser of the double-submit race (P2002 → 409)", async () => {
    create.mockRejectedValue(P2002);
    const res = await post(signupBody("race@signup.test"), "203.0.113.152");
    expect(res.status).toBe(409);
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing when the per-IP throttle answers 429", async () => {
    const ip = "203.0.113.153";
    findUnique.mockResolvedValue({ id: 12, email: "t@signup.test", fullName: "T" }); // cheap 409s
    for (let i = 0; i < 10; i++) expect((await post(signupBody("t@signup.test"), ip)).status).toBe(409);
    const res = await post(signupBody("t@signup.test"), ip);
    expect(res.status).toBe(429);
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing when validation fails (400)", async () => {
    const res = await post({ role: "student", email: "nope", password: "x", fullName: "", tosAccepted: false }, "203.0.113.154");
    expect(res.status).toBe(400);
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("a failing welcome email never affects the signup response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValue(new Error("resend down"));
    create.mockResolvedValue({ id: 13, email: "resilient@signup.test", fullName: "Ada Lovelace" });
    const res = await post(signupBody("resilient@signup.test"), "203.0.113.155");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, isAdmin: false });
    await flush();
  });
});

describe("google find-or-create: welcome on create only", () => {
  const profile = { sub: "g-1", email: "New@Google.test", emailVerified: true, name: "Ada Lovelace" };

  it("sends once when the account is actually created", async () => {
    create.mockResolvedValue({ id: 20, email: "new@google.test", fullName: "Ada Lovelace" });
    await findOrCreateGoogleUser(profile);
    await flush();
    expect(sentWelcome()).toHaveLength(1);
    expect(sentWelcome()[0].to).toBe("new@google.test");
  });

  it("sends nothing on the auto-link path (email already has an account)", async () => {
    findUnique.mockResolvedValue({ id: 21, email: "new@google.test", fullName: "Ada Lovelace", password: "$h" });
    await findOrCreateGoogleUser(profile);
    await flush();
    expect(create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing to the P2002 race loser that re-fetches the winner's row", async () => {
    const winner = { id: 22, email: "new@google.test", fullName: "Ada Lovelace", password: null };
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    create.mockRejectedValue(P2002);
    expect(await findOrCreateGoogleUser(profile)).toEqual(winner);
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing for an unverified Google email", async () => {
    await expect(findOrCreateGoogleUser({ ...profile, emailVerified: false })).rejects.toThrow("google_email_unverified");
    await flush();
    expect(send).not.toHaveBeenCalled();
  });
});
