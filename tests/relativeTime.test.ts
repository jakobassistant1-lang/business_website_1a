// The canonical relative-timestamp helper (lib/calendarDates.relativeTime) plus a
// guard that the Connections tab actually renders the "last synced" line — the
// literal timestamp regressed out of the live UI when PlanView was retired.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { relativeTime } from "@/lib/calendarDates";

const now = new Date(2026, 8, 21, 12, 0, 0); // Sep 21, 2026, 12:00 local
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("under a minute reads 'just now' (and the 60s boundary flips to minutes)", () => {
    expect(relativeTime(ago(0), now)).toBe("just now");
    expect(relativeTime(ago(59 * SEC), now)).toBe("just now");
    expect(relativeTime(ago(60 * SEC), now)).toBe("1 min ago");
  });

  it("minutes floor, up to the 60-minute boundary", () => {
    expect(relativeTime(ago(12 * MIN), now)).toBe("12 min ago");
    expect(relativeTime(ago(59 * MIN + 59 * SEC), now)).toBe("59 min ago");
    expect(relativeTime(ago(HOUR), now)).toBe("1 hour ago");
  });

  it("hours pluralize and run to the 24-hour boundary", () => {
    expect(relativeTime(ago(3 * HOUR), now)).toBe("3 hours ago");
    expect(relativeTime(ago(23 * HOUR + 59 * MIN), now)).toBe("23 hours ago");
    expect(relativeTime(ago(DAY), now)).toBe("yesterday");
  });

  it("days: yesterday, then 'N days ago' through day 6", () => {
    expect(relativeTime(ago(2 * DAY), now)).toBe("2 days ago");
    expect(relativeTime(ago(6 * DAY), now)).toBe("6 days ago");
  });

  it("a week or more falls back to a short date", () => {
    expect(relativeTime(ago(7 * DAY), now)).toBe("Sep 14");
    expect(relativeTime(ago(30 * DAY), now)).toBe("Aug 22");
  });

  it("a different year keeps the year", () => {
    expect(relativeTime(ago(365 * DAY), now)).toBe("Sep 21, 2025");
  });

  it("future timestamps clamp to 'just now'; junk reads 'unknown'", () => {
    expect(relativeTime(new Date(now.getTime() + 5 * MIN).toISOString(), now)).toBe("just now");
    expect(relativeTime("not-a-date", now)).toBe("unknown");
  });

  it("is pure — the same inputs give the same answer", () => {
    const iso = ago(45 * MIN);
    expect(relativeTime(iso, now)).toBe(relativeTime(iso, new Date(now)));
  });
});

describe("Connections tab shows when data was last refreshed", () => {
  const form = readFileSync("components/ConnectionsForm.tsx", "utf8");
  const page = readFileSync("app/(app)/connections/page.tsx", "utf8");

  it("ConnectionsForm renders the 'Last synced' line (with a never-synced fallback)", () => {
    expect(form).toMatch(/Last synced \$\{relativeTime\(initial\.syncedAt\)\}/);
    expect(form).toContain("Never synced yet");
    expect(form).toMatch(/Checked \$\{relativeTime\(initial\.lastValidatedAt\)\}/);
  });

  it("uses the shared helper and the muted token — no private date math, no hardcoded color", () => {
    expect(form).toContain('import { relativeTime } from "@/lib/calendarDates"');
    expect(form).toContain('text-[13px] text-muted');
    expect(form).not.toMatch(/toLocaleString|toLocaleDateString|86_?400_?000/);
  });

  it("the page feeds it both timestamps", () => {
    expect(page).toMatch(/syncedAt: cred\?\.syncedAt/);
    expect(page).toMatch(/lastValidatedAt: cred\?\.lastValidatedAt/);
  });
});
