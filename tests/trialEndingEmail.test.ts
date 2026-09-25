// #121 (trial-ending half) — the pure builder's copy, the price fallback, the
// date helper and the never-throws sender. `@/lib/email` and `@/lib/stripe` are
// mocked, so no test can send a real message or call Stripe.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/funnel", () => ({ logEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/stripe", () => ({ priceDisplay: vi.fn(async () => "$4.99/month") }));

import { sendEmail } from "@/lib/email";
import { logEvent } from "@/lib/funnel";
import { priceDisplay } from "@/lib/stripe";
import { formatDateHuman, formatDateTimeHuman } from "@/lib/calendarDates";
import {
  trialEndingEmail,
  trialEndingSubject,
  trialEndingPrice,
  trialEndOf,
  sendTrialEndingEmail,
  TRIAL_ENDING_PRICE_FALLBACK,
} from "@/lib/trialEndingEmail";

type Fn = ReturnType<typeof vi.fn>;
const send = sendEmail as unknown as Fn;
const log = logEvent as unknown as Fn;
const price = priceDisplay as unknown as Fn;

const APP = "https://app.navolearning.test";
const PRICE = "$4.99/month";
const T = 1_760_000_000; // 2025-10-09T08:53:20Z → Thursday, October 9 at 4:53 AM ET
const END = new Date(T * 1000);
const CUTOFF = "Thursday, October 9 at 4:53 AM ET";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", APP);
  send.mockResolvedValue({ ok: true });
  price.mockResolvedValue(PRICE);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("trialEndingEmail — the pure builder", () => {
  const built = (over: Partial<Parameters<typeof trialEndingEmail>[0]> = {}) =>
    trialEndingEmail({ firstName: "Ada", price: PRICE, trialEnd: END, appUrl: APP, ...over });

  it("subject carries the human charge date (day only); a Date and epoch ms render the same", () => {
    expect(built().subject).toBe("Your Navo trial ends Thursday, October 9 — here's what happens next");
    expect(trialEndingSubject(END)).toBe(built().subject);
    expect(trialEndingSubject(T * 1000)).toBe(built().subject);
    expect(built().subject).toContain(formatDateHuman(END, { weekday: true }));
  });

  it("the body states the EXACT cutoff (date + time + zone) — a date alone is wrong west of New York", () => {
    const { html, text } = built();
    expect(text).toContain(`Your free Navo trial ends ${CUTOFF}.`);
    expect(html).toContain(`<strong>${CUTOFF}</strong>`);
    expect(CUTOFF).toBe(formatDateTimeHuman(END));
    // 06:00Z on the 10th is 2:00 AM ET — still the evening of the 9th for a Pacific student.
    const late = trialEndingEmail({ firstName: "Ada", price: PRICE, trialEnd: Date.UTC(2025, 9, 10, 6, 0), appUrl: APP });
    expect(late.text).toContain("Your free Navo trial ends Friday, October 10 at 2:00 AM ET.");
    expect(late.subject).toContain("Friday, October 10");
  });

  it("uses the Stripe price string verbatim in html and text", () => {
    const { html, text } = built();
    expect(text).toContain(`After that, ${PRICE} is charged to the card on file each month.`);
    expect(html).toContain(`<strong>${PRICE}</strong>`);
  });

  it("with the fallback price the copy stays honest and names no number", () => {
    const { html, text } = built({ price: TRIAL_ENDING_PRICE_FALLBACK });
    expect(text).toContain(`After that, ${TRIAL_ENDING_PRICE_FALLBACK} is charged to the card on file each month.`);
    for (const blob of [text, html]) {
      expect(blob).not.toMatch(/\$\s?\d/);
      expect(blob).not.toMatch(/\b4[.,]99\b/);
    }
  });

  it("links 'Keep going' to /dashboard and 'Manage or cancel' to /account on the configured appUrl (html + text)", () => {
    const { html, text } = built();
    expect(text).toContain(`Keep going: ${APP}/dashboard`);
    expect(text).toContain(`Manage or cancel: ${APP}/account`);
    expect(html).toContain(`href="${APP}/dashboard"`);
    expect(html).toContain(`href="${APP}/account"`);
    expect(html).toContain(">Keep going</a>");
    expect(html).toContain(">Manage or cancel</a>");
  });

  it("normalises a trailing slash on appUrl instead of emitting '//'", () => {
    const { html, text } = built({ appUrl: `${APP}/` });
    expect(html).toContain(`href="${APP}/dashboard"`);
    expect(text).not.toContain(`${APP}//`);
  });

  it("says cancel is possible anytime ('before then' — the cutoff just stated), that nothing has been charged yet, and that the account keeps everything", () => {
    const { text, html } = built();
    expect(text).toContain("cancel anytime");
    expect(text).toContain("cancel before then and nothing is charged");
    expect(text).toContain("and you won't be charged.");
    for (const blob of [text, html]) expect(blob).not.toContain("charged again"); // no charge has happened during a trial
    expect(text).toContain("stay exactly where they are");
    expect(html).toContain("stay exactly where they are");
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
    expect(text.startsWith("Hi Ada,")).toBe(true);
    expect(text.length).toBeGreaterThan(100);
    expect(text).not.toContain("<");
    expect(html).toContain("<a href=");
    expect(html).toContain("style=");
  });

  it("never implies Navo is free beyond the trial", () => {
    const { text, html } = built();
    for (const blob of [text, html]) {
      expect(blob.toLowerCase()).not.toMatch(/free\s+forever|forever\s+free|free\s+plan|no\s+credit\s+card/);
    }
  });
});

describe("trialEndingPrice — Stripe or the neutral fallback", () => {
  it("returns the Stripe price string", async () => {
    expect(await trialEndingPrice()).toBe(PRICE);
  });
  it("falls back when Stripe throws or is unconfigured", async () => {
    price.mockRejectedValue(new Error("STRIPE_SECRET_KEY is not set"));
    expect(await trialEndingPrice()).toBe(TRIAL_ENDING_PRICE_FALLBACK);
    expect(TRIAL_ENDING_PRICE_FALLBACK).not.toMatch(/\d/);
  });
});

describe("trialEndOf — the trial-end instant from the event, else the stored date", () => {
  it("converts trial_end (unix seconds) to a Date", () => {
    expect(trialEndOf({ trial_end: T })).toEqual(END);
  });
  it("falls back to the stored trialEndsAt, else null", () => {
    expect(trialEndOf({ trial_end: null }, END)).toEqual(END);
    expect(trialEndOf({}, null)).toBeNull();
    expect(trialEndOf({ trial_end: 0 })).toBeNull();
  });
});

describe("sendTrialEndingEmail — fire-and-forget", () => {
  const ada = { id: 1, email: "ada@school.test", fullName: "Ada Lovelace" };

  it("sends to the account's address with the date from trial_end and the Stripe price", async () => {
    await sendTrialEndingEmail(ada, { trial_end: T });
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0] as { to: string; subject: string; text: string; html: string };
    expect(msg.to).toBe("ada@school.test");
    expect(msg.subject).toBe("Your Navo trial ends Thursday, October 9 — here's what happens next");
    expect(msg.text).toContain(`Your free Navo trial ends ${CUTOFF}.`);
    expect(msg.text).toContain("Hi Ada,");
    expect(msg.text).toContain(PRICE);
    expect(msg.html).toContain(`href="${APP}/dashboard"`);
    expect(msg.html).toContain(`href="${APP}/account"`);
  });

  it("greets a null-name account with 'there'", async () => {
    await sendTrialEndingEmail({ id: 2, email: "anon@school.test", fullName: null }, { trial_end: T });
    expect((send.mock.calls[0][0] as { text: string }).text.startsWith("Hi there,")).toBe(true);
  });

  it("uses the fallback price copy when Stripe is unreachable — still sends", async () => {
    price.mockRejectedValue(new Error("stripe down"));
    await sendTrialEndingEmail(ada, { trial_end: T });
    expect(send).toHaveBeenCalledTimes(1);
    const { text } = send.mock.calls[0][0] as { text: string };
    expect(text).toContain(TRIAL_ENDING_PRICE_FALLBACK);
    expect(text).not.toMatch(/\$\s?\d/);
  });

  it("logs trial_ending_sent only when the send reports ok, threading the caller's meta (the Stripe event id)", async () => {
    await sendTrialEndingEmail({ id: 3, email: "ok@school.test", fullName: "Ok Person" }, { trial_end: T }, "", { eventId: "evt_9", source: "webhook" });
    expect(log).toHaveBeenCalledWith("trial_ending_sent", 3, { eventId: "evt_9", source: "webhook" });
    log.mockClear();
    await sendTrialEndingEmail({ id: 3, email: "ok@school.test", fullName: "Ok Person" }, { trial_end: T });
    expect(log).toHaveBeenCalledWith("trial_ending_sent", 3, undefined); // no meta → none

    log.mockClear();
    send.mockResolvedValue({ ok: false });
    await sendTrialEndingEmail({ id: 4, email: "bad@school.test", fullName: "No Send" }, { trial_end: T });
    expect(log).not.toHaveBeenCalled();
  });

  it("swallows a thrown sendEmail — resolves, never rejects, logs nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValue(new Error("resend exploded"));
    await expect(sendTrialEndingEmail({ id: 5, email: "boom@school.test", fullName: "Boom" }, { trial_end: T })).resolves.toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("does nothing (and still never throws) without an address", async () => {
    await expect(sendTrialEndingEmail({ id: 6, email: "", fullName: "No Address" }, { trial_end: T })).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it("does nothing without a date (no trial_end on the event, no trialEndsAt on file) — never a blank date", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendTrialEndingEmail({ id: 7, email: "nodate@school.test", fullName: "No Date" }, { trial_end: null })).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("falls back to the stored trialEndsAt when the event carries no trial_end", async () => {
    await sendTrialEndingEmail({ id: 8, email: "stored@school.test", fullName: "Stored", trialEndsAt: new Date(T * 1000) }, {});
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][0] as { subject: string }).subject).toContain("Thursday, October 9");
  });
});
