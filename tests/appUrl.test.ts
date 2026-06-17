import { describe, it, expect, afterEach, vi } from "vitest";
import { appOrigin } from "@/lib/appUrl";

afterEach(() => vi.unstubAllEnvs());

// The emailed reset link's origin must come from TRUSTED config, never the
// request Host header (which an attacker can spoof → reset-link poisoning).
describe("appOrigin", () => {
  it("prefers APP_URL and strips a trailing slash", () => {
    vi.stubEnv("APP_URL", "https://pinnavel.com/");
    expect(appOrigin("https://attacker.example")).toBe("https://pinnavel.com");
  });

  it("falls back to GOOGLE_AUTH_REDIRECT_URI's origin when APP_URL is unset", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("GOOGLE_AUTH_REDIRECT_URI", "https://pinnavel.com/api/auth/google/callback");
    expect(appOrigin("https://attacker.example")).toBe("https://pinnavel.com");
  });

  it("falls back to Vercel's production URL when neither APP_URL nor the redirect URI is set", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("GOOGLE_AUTH_REDIRECT_URI", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "pinnavel.com");
    expect(appOrigin("https://attacker.example")).toBe("https://pinnavel.com");
  });

  it("uses the request origin only as a last resort, with no trusted config (dev)", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("GOOGLE_AUTH_REDIRECT_URI", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(appOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("never uses a spoofed request origin when trusted config is present", () => {
    vi.stubEnv("APP_URL", "https://pinnavel.com");
    expect(appOrigin("https://evil.attacker.test")).not.toContain("attacker");
  });
});
