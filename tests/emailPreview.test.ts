// Self-service transactional-email preview (POST /api/account/email-preview).
// `@/lib/email` is mocked, so no test can send a real message. The limiter is the
// real shared one (module-scope Map), so every test uses its own user id.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/funnel", () => ({ logEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/stripe", () => ({ priceDisplay: vi.fn(async () => "$4.99/month") }));

import { requireUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { logEvent } from "@/lib/funnel";
import { priceDisplay } from "@/lib/stripe";
import { WELCOME_SUBJECT } from "@/lib/welcomeEmail";
import { trialEndingSubject, TRIAL_ENDING_PRICE_FALLBACK } from "@/lib/trialEndingEmail";
import { formatDateTimeHuman } from "@/lib/calendarDates";
import { TRIAL_DAYS } from "@/lib/subscription";
import { POST } from "@/app/api/account/email-preview/route";

type Fn = ReturnType<typeof vi.fn>;
const authed = requireUser as unknown as Fn;
const send = sendEmail as unknown as Fn;
const log = logEvent as unknown as Fn;
const price = priceDisplay as unknown as Fn;

const APP = "https://app.navolearning.test";
const ROUTE = "app/api/account/email-preview/route.ts";
const PRICE = "$4.99/month";
const T = 1_760_000_000; // → "Thursday, October 9" in the billing time zone

const userOf = (id: number, over: { trialEndsAt?: Date | null } = {}) => ({ id, email: `student${id}@example.edu`, fullName: "Ada Lovelace", ...over });

const post = (body: unknown) =>
  POST(new Request("http://x/api/account/email-preview", { method: "POST", body: JSON.stringify(body) }));

/** The one message the mocked sender was handed. */
const sent = () => send.mock.calls[0][0] as { to: string; subject: string; text: string; html?: string };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", APP);
  send.mockResolvedValue({ ok: true });
  price.mockResolvedValue(PRICE);
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

  it("trial_ending: sends the production template with the previewer's own trialEndsAt and the Stripe price", async () => {
    const u = userOf(110, { trialEndsAt: new Date(T * 1000) });
    authed.mockResolvedValue(u);
    const res = await post({ template: "trial_ending" });
    expect(res.status).toBe(200);
    const subject = trialEndingSubject(u.trialEndsAt as Date);
    expect(subject).toBe("Your Navo trial ends Thursday, October 9 — here's what happens next");
    expect(await res.json()).toEqual({ ok: true, to: u.email, subject });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent().to).toBe(u.email);
    expect(sent().subject).toBe(subject);
    expect(sent().text).toContain("Hi Ada,");
    expect(sent().text).toContain("Your free Navo trial ends Thursday, October 9 at 4:53 AM ET."); // the exact cutoff, via formatDateTimeHuman
    expect(sent().text).toContain(PRICE);
    expect(sent().html).toContain(`href="${APP}/dashboard"`);
    expect(sent().html).toContain(`href="${APP}/account"`);
    expect(price).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled(); // a preview is not a real send
  });

  it("trial_ending: without a trialEndsAt on file the cutoff is now + TRIAL_DAYS", async () => {
    authed.mockResolvedValue(userOf(111, { trialEndsAt: null }));
    const before = Date.now();
    const res = await post({ template: "trial_ending" });
    expect(res.status).toBe(200);
    const expectedEnd = before + TRIAL_DAYS * 86_400_000;
    expect((await res.json()).subject).toBe(trialEndingSubject(expectedEnd));
    // The minute may tick between `before` and the route's Date.now(); accept either rendering.
    const cutoffs = [formatDateTimeHuman(expectedEnd), formatDateTimeHuman(Date.now() + TRIAL_DAYS * 86_400_000)];
    expect(cutoffs.some((c) => sent().text.includes(`Your free Navo trial ends ${c}.`))).toBe(true);
  });

  it("trial_ending: Stripe unreachable → the neutral price fallback, still sends", async () => {
    price.mockRejectedValue(new Error("stripe down"));
    authed.mockResolvedValue(userOf(112, { trialEndsAt: new Date(T * 1000) }));
    const res = await post({ template: "trial_ending" });
    expect(res.status).toBe(200);
    expect(sent().text).toContain(TRIAL_ENDING_PRICE_FALLBACK);
    expect(sent().text).not.toMatch(/\$\s?\d/);
  });

  it("welcome never reads the price (no Stripe call for a template that has no price)", async () => {
    authed.mockResolvedValue(userOf(113));
    await post({ template: "welcome" });
    expect(price).not.toHaveBeenCalled();
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
