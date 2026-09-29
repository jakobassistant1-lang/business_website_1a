import { describe, expect, it } from "vitest";
import { DEFAULT_STUDENT_ZONE, dataToday, dataZone, dayDiffInZone, isValidZone, studentZone, todayInZone } from "@/lib/studentZone";
import { isPassiveItem } from "@/lib/itemType";

describe("studentZone — the one zone for every day/date rule", () => {
  it("uses the Canvas profile zone when valid, else the default", () => {
    expect(studentZone({ timeZone: "America/Denver" })).toBe("America/Denver");
    expect(studentZone({ timeZone: "Not/AZone" })).toBe(DEFAULT_STUDENT_ZONE);
    expect(studentZone({ timeZone: null })).toBe(DEFAULT_STUDENT_ZONE);
    expect(studentZone(null)).toBe(DEFAULT_STUDENT_ZONE);
    expect(isValidZone("UTC")).toBe(true);
    expect(isValidZone("")).toBe(false);
  });
  it("today and day differences are read in the zone", () => {
    const now = new Date("2026-09-29T02:30:00Z"); // Mon Sep 28, 10:30 PM in New York
    expect(todayInZone("America/New_York", now)).toBe("2026-09-28");
    expect(todayInZone("UTC", now)).toBe("2026-09-29");
    const due = "2026-10-01T03:59:00Z"; // Wed Sep 30, 11:59 PM in New York
    expect(dayDiffInZone(due, "America/New_York", now)).toBe(2);
    expect(dayDiffInZone(due, "UTC", now)).toBe(2); // Oct 1 vs Sep 29 in UTC
    expect(dayDiffInZone("2026-09-28T12:00:00Z", "America/New_York", now)).toBe(0);
    expect(dayDiffInZone("2026-09-27T12:00:00Z", "America/New_York", now)).toBe(-1);
  });
  it("dataZone/dataToday read what the loader attached", () => {
    expect(dataZone({ timeZone: "America/Chicago" })).toBe("America/Chicago");
    expect(dataZone({})).toBe(DEFAULT_STUDENT_ZONE);
    expect(dataToday({ todayYmd: "2026-09-28" })).toBe("2026-09-28");
  });
});

describe("isPassiveItem — the one passive-grade predicate", () => {
  it("passive only when the AI said no action, there's no online submission, and it's not a test", () => {
    expect(isPassiveItem({ requiresAction: false, submissionType: "none", type: "assignment" })).toBe(true);
    expect(isPassiveItem({ requiresAction: false, submissionType: "online_upload", type: "assignment" })).toBe(false);
    expect(isPassiveItem({ requiresAction: false, submissionType: "none", type: "exam" })).toBe(false);
    expect(isPassiveItem({ requiresAction: null, submissionType: "none", type: "assignment" })).toBe(false);
    expect(isPassiveItem({ requiresAction: true, submissionType: null, type: "other" })).toBe(false);
  });
});
