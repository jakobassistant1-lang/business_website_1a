import { describe, it, expect, vi, afterEach } from "vitest";
import { sendEmail } from "@/lib/email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendEmail — dev fallback (no provider configured)", () => {
  it("does not call fetch, logs the message, and returns ok when the key is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await sendEmail({ to: "a@b.com", subject: "Hi", text: "link: https://x/y" });

    expect(res).toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled(); // the reset link is visible in the dev console
  });
});

describe("sendEmail — via Resend (configured)", () => {
  it("POSTs to the Resend endpoint with Bearer auth and a JSON body", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "StudyPlan <noreply@pinnavel.com>");
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await sendEmail({ to: "a@b.com", subject: "Hi", text: "hello" });

    expect(res).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("StudyPlan <noreply@pinnavel.com>");
    expect(body.to).toBe("a@b.com");
    expect(body.subject).toBe("Hi");
  });

  it("returns ok:false when Resend responds non-2xx", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "StudyPlan <noreply@pinnavel.com>");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 422 })));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await sendEmail({ to: "a@b.com", subject: "Hi", text: "hello" });
    expect(res).toEqual({ ok: false });
  });
});
