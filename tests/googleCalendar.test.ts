import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeEvent } from "@/lib/googleCalendar/calendar";
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  isGoogleConfigured,
  CALENDAR_READONLY_SCOPE,
} from "@/lib/googleCalendar/auth";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import type { GoogleApiEvent } from "@/lib/googleCalendar/types";

describe("normalizeEvent (Google → internal adapter)", () => {
  it("maps a timed event into the internal shape", () => {
    const e: GoogleApiEvent = {
      id: "a1",
      summary: "Lecture",
      description: "CS 350",
      location: "Hall A",
      start: { dateTime: "2026-06-10T14:00:00Z" },
      end: { dateTime: "2026-06-10T15:00:00Z" },
    };
    expect(normalizeEvent(e)).toEqual({
      id: "a1",
      title: "Lecture",
      description: "CS 350",
      startTime: "2026-06-10T14:00:00.000Z",
      endTime: "2026-06-10T15:00:00.000Z",
      location: "Hall A",
      source: "google",
    });
  });

  it("maps an all-day (date-only) event", () => {
    const r = normalizeEvent({ id: "a2", summary: "Holiday", start: { date: "2026-06-12" }, end: { date: "2026-06-13" } });
    expect(r?.startTime).toBe("2026-06-12T00:00:00.000Z");
    expect(r?.source).toBe("google");
  });

  it("defaults a missing title and drops events with no id / no times", () => {
    expect(
      normalizeEvent({ id: "a3", start: { dateTime: "2026-06-10T14:00:00Z" }, end: { dateTime: "2026-06-10T15:00:00Z" } })
        ?.title,
    ).toBe("(no title)");
    expect(normalizeEvent({ summary: "x", start: { dateTime: "2026-06-10T14:00:00Z" } })).toBeNull(); // no id
    expect(normalizeEvent({ id: "a4", start: { dateTime: "2026-06-10T14:00:00Z" } })).toBeNull(); // no end
  });
});

describe("buildAuthUrl + isGoogleConfigured", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requests the read-only scope, offline access, and carries the state", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "https://app/cb");
    const url = buildAuthUrl("xyz");
    expect(url).toContain("client_id=cid");
    expect(url).toContain(encodeURIComponent(CALENDAR_READONLY_SCOPE));
    expect(url).toContain("access_type=offline");
    expect(url).toContain("state=xyz");
  });

  it("is configured only when all three vars are present", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    expect(isGoogleConfigured()).toBe(false);
    vi.stubEnv("GOOGLE_CLIENT_ID", "a");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "b");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "c");
    expect(isGoogleConfigured()).toBe(true);
  });
});

describe("token exchange + refresh", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("parses an authorization-code exchange", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: "AT", refresh_token: "RT", expires_in: 3600, scope: "x", token_type: "Bearer" }),
      })),
    );
    const t = await exchangeCodeForTokens("code");
    expect(t).toMatchObject({ accessToken: "AT", refreshToken: "RT" });
    expect(t.expiresAt).toBeInstanceOf(Date);
  });

  it("throws on a failed exchange (OAuth failure path)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })));
    await expect(exchangeCodeForTokens("bad")).rejects.toThrow();
  });

  it("keeps the existing refresh token when a refresh response omits it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ access_token: "AT2", expires_in: 3600 }) })));
    const t = await refreshAccessToken("OLD_RT");
    expect(t.accessToken).toBe("AT2");
    expect(t.refreshToken).toBe("OLD_RT");
  });
});

describe("token encryption at rest", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips with a key, and the stored value isn't the plaintext", () => {
    vi.stubEnv("ENCRYPTION_KEY", "super-secret-key");
    const stored = encryptSecret("refresh-token-123");
    expect(stored).not.toContain("refresh-token-123");
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(stored)).toBe("refresh-token-123");
  });

  it("round-trips in plaintext mode when no key is set", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(decryptSecret(encryptSecret("tok"))).toBe("tok");
  });
});
