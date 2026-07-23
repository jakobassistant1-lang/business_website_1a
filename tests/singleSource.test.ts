// Guards for the single-source-calculation rule (Calvin, 2026-07-21): the
// canonical helpers behave as specified, AND no new private copies of them
// creep back into app/lib/components (the grep guards).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { fmtHours, effortHoursText } from "@/lib/effortFormat";
import { isAssignmentDone } from "@/lib/assignmentStatus";

describe("effortFormat (canonical hours text)", () => {
  it("sub-hour always reads as minutes, never a decimal hour", () => {
    expect(fmtHours(0.25)).toBe("15m");
    expect(fmtHours(0.34)).toBe("20m"); // rounds to nearest 5
    expect(fmtHours(0.9)).toBe("55m");
    expect(effortHoursText(0.5)).toBe("~30m");
  });
  it("hour-plus shows hours to one decimal", () => {
    expect(fmtHours(1)).toBe("1h");
    expect(fmtHours(2.25)).toBe("2.3h");
    expect(effortHoursText(6)).toBe("~6h");
  });
  it("no usable number → null (briefing drops the label)", () => {
    expect(effortHoursText(null)).toBeNull();
    expect(effortHoursText(0)).toBeNull();
    expect(effortHoursText(undefined)).toBeNull();
  });
});

describe("assignmentStatus (canonical done rule)", () => {
  const at = new Date("2026-07-01T12:00:00Z");
  it("submitted and not reopened → done", () => {
    expect(isAssignmentDone({ submittedAt: at, submissionState: "submitted" })).toBe(true);
    expect(isAssignmentDone({ submittedAt: at, submissionState: "graded" })).toBe(true);
    expect(isAssignmentDone({ submittedAt: at, submissionState: null })).toBe(true);
  });
  it("instructor reopened (unsubmitted) → NOT done, even with a timestamp", () => {
    expect(isAssignmentDone({ submittedAt: at, submissionState: "unsubmitted" })).toBe(false);
  });
  it("never submitted → not done", () => {
    expect(isAssignmentDone({ submittedAt: null, submissionState: null })).toBe(false);
  });
  it("student's manual checkoff → done, no submission needed", () => {
    expect(isAssignmentDone({ manualDoneAt: at, submittedAt: null, submissionState: null })).toBe(true);
  });
  it("manual checkoff survives an instructor reopen (the student's word is final)", () => {
    expect(isAssignmentDone({ manualDoneAt: at, submittedAt: at, submissionState: "unsubmitted" })).toBe(true);
  });
  it("unchecked (null) falls back to the submission rule", () => {
    expect(isAssignmentDone({ manualDoneAt: null, submittedAt: null, submissionState: null })).toBe(false);
    expect(isAssignmentDone({ manualDoneAt: null, submittedAt: at, submissionState: "submitted" })).toBe(true);
  });
});

// --- grep guards: fail if a private copy of a canonical calculation reappears ---
const ROOTS = ["app", "components", "lib"];
const EXEMPT = new Set(["lib/effortFormat.ts", "lib/assignmentStatus.ts", "lib/calendarDates.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const files = ROOTS.flatMap((r) => walk(r)).filter((f) => !EXEMPT.has(f.replace(/\\/g, "/")));

describe("no private copies of canonical calculations", () => {
  it("the done rule exists only in lib/assignmentStatus", () => {
    const offenders = files.filter((f) => /submittedAt\s*!==\s*null\s*&&\s*\w+\.?\w*submissionState\s*!==\s*["']unsubmitted["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("sub-hour '<N.Nh>' effort formatting exists only in lib/effortFormat", () => {
    // the tell: rounding hours to one decimal and appending "h" outside the canonical file
    const offenders = files.filter((f) => /Math\.round\([^)]*\*\s*10\)\s*\/\s*10\s*\}?\s*[+`]?\s*["'`]?h/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("midnight-snapping (setHours(0,0,0,0)) exists only in lib/calendarDates", () => {
    // day math must go through startOfDay/daysBetween — 6 private copies were consolidated 2026-07-21
    const offenders = files.filter((f) => /setHours\(0,\s*0,\s*0,\s*0\)/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
