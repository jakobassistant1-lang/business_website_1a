// Self-service transactional-email preview (POST /api/account/email-preview).
// `@/lib/email` is mocked, so no test can send a real message. The limiter is the
// real shared one (module-scope Map), so every test uses its own user id.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/funnel", () => ({ logEvent: vi.fn(async () => undefined) }));

import { requireUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { logEvent } from "@/lib/funnel";
import { WELCOME_SUBJECT } from "@/lib/welcomeEmail";
import { POST } from "@/app/api/account/email-preview/route";

type Fn = ReturnType<typeof vi.fn>;
const authed = requireUser as unknown as Fn;
const send = sendEmail as unknown as Fn;
const log = logEvent as unknown as Fn;

const APP = "https://app.navolearning.test";
const ROUTE = "app/api/account/email-preview/route.ts";

const userOf = (id: number) => ({ id, email: `student${id}@example.edu`, fullName: "Ada Lovelace" });

const post = (body: unknown) =>
  POST(new Request("http://x/api/account/email-preview", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", APP);
  send.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/account/email-preview", () => {
  it("401s without a session and sends nothing", async () => {
    authed.mockResolvedValue(null);
    const res = await post({ template: "welcome" });
    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("400s an unknown (or missing) template and sends nothing", async () => {
    authed.mockResolvedValue(userOf(101));
    for (const body of [{ template: "nope" }, { template: "toString" }, {}]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "unknown_template" });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("welcome: sends exactly one welcome email to the session user's own address", async () => {
    const u = userOf(102);
    authed.mockResolvedValue(u);
    const res = await post({ template: "welcome" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, to: u.email, subject: WELCOME_SUBJECT });
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0] as { to: string; subject: string; text: string; html?: string };
    expect(msg.to).toBe(u.email);
    expect(msg.subject).toBe(WELCOME_SUBJECT);
    expect(msg.text).toContain("Hi Ada,");
    expect(msg.text).toContain(`${APP}/`);
    expect(msg.html).toContain(`href="${APP}/"`);
    expect(log).not.toHaveBeenCalled(); // a preview is not a real welcome
  });

  it("reports ok:false when the provider fails", async () => {
    authed.mockResolvedValue(userOf(103));
    send.mockResolvedValue({ ok: false });
    const res = await post({ template: "welcome" });
    expect((await res.json()).ok).toBe(false);
  });

  it("ignores a `to` in the body — no relay", async () => {
    const u = userOf(104);
    authed.mockResolvedValue(u);
    const res = await post({ template: "welcome", to: "victim@elsewhere.com" });
    expect((await res.json()).to).toBe(u.email);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][0] as { to: string }).to).toBe(u.email);
  });

  it("allows 3 previews per user per hour; the 4th is 429 and sends nothing", async () => {
    authed.mockResolvedValue(userOf(105));
    for (let i = 0; i < 3; i++) expect((await post({ template: "welcome" })).status).toBe(200);
    const res = await post({ template: "welcome" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many previews. Try again in an hour." });
    expect(send).toHaveBeenCalledTimes(3);
    // A different user has their own bucket.
    authed.mockResolvedValue(userOf(106));
    expect((await post({ template: "welcome" })).status).toBe(200);
  });
});

describe("grep guard: email-preview route", () => {
  const src = readFileSync(ROUTE, "utf8");
  it("never reads a recipient from the request body", () => {
    expect(/body\s*(\?\.)?\s*\.\s*to\b/.test(src)).toBe(false);
    expect(/body\s*\[\s*["']to["']\s*\]/.test(src)).toBe(false);
    expect(/\{\s*[^}]*\bto\b[^}]*\}\s*=\s*(await\s+)?(body|req\.json)/.test(src)).toBe(false);
    expect(src.includes("to: user.email")).toBe(true);
  });
  it("is rate-limited through the shared limiter", () => {
    expect(src.includes("rateLimit(")).toBe(true);
    expect(src.includes('from "@/lib/rateLimit"')).toBe(true);
  });
  it("does not log a funnel event", () => {
    expect(src.includes("logEvent")).toBe(false);
    expect(src.includes("@/lib/funnel")).toBe(false);
  });
});
