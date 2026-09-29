// "EVERYTHING SHOULD AGREE EVERYWHERE" (owner, 2026-09-28) — the course card and
// the course page read ONE split (lib/courseCounts). Behaviour first: fixtures with
// passive, locked, past-due and done items; the audit's "Nothing upcoming." beside
// "3 upcoming" must be impossible. Then source guards over the files this change
// owns: dates in the student's zone, "course"/"Past due" wording, and study
// sessions only through the one isStudySessionBlock rule.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { courseBuckets, courseCounts, courseSummaryParts, countsOf, doNext, doneReasonOf, doneRowView, isClear, DONE_REASON_LABEL } from "@/lib/courseCounts";
import type { CalendarItem } from "@/lib/calendarData";

let nextId = 1;
function item(over: Partial<CalendarItem> = {}): CalendarItem {
  return {
    canvasId: nextId++,
    name: "Item",
    courseName: "Micro",
    courseCanvasId: 9,
    dueAt: "2026-10-05T03:59:00Z",
    type: "assignment",
    status: "normal",
    studyLeadDays: null,
    pointsPossible: 10,
    estimatedEffortHours: 1,
    effortBucket: null,
    summary: null,
    htmlUrl: null,
    score: null,
    groupId: null,
    groupName: null,
    groupWeight: null,
    manuallyDone: false,
    ...over,
  };
}

describe("courseBuckets / courseCounts — every item in exactly one list", () => {
  const upcomingA = item({ name: "Problem set" });
  const upcomingB = item({ name: "Essay" });
  const pastDue = item({ name: "Late lab", status: "overdue" });
  const locked = item({ name: "Final project", locked: true, unlockAt: "2026-10-20T04:00:00Z" });
  const passive1 = item({ name: "Participation", passive: true });
  const passive2 = item({ name: "Attendance", passive: true, status: "overdue" }); // passive wins over past due
  const lockedLate = item({ name: "Locked + late", locked: true, status: "overdue" }); // locked wins over past due
  const done = item({ name: "Quiz 1", status: "done", type: "quiz", doneReason: "graded", score: 9 });
  const items = [upcomingA, pastDue, locked, passive1, upcomingB, passive2, lockedLate];

  it("splits active work into Past due / Upcoming / Not open yet / Graded by your teacher, and completed into Done", () => {
    const b = courseBuckets(items, [done]);
    expect(b.pastDue.map((i) => i.name)).toEqual(["Late lab"]);
    expect(b.upcoming.map((i) => i.name).sort()).toEqual(["Essay", "Problem set"]);
    expect(b.notOpenYet.map((i) => i.name).sort()).toEqual(["Final project", "Locked + late"]);
    expect(b.passive.map((i) => i.name).sort()).toEqual(["Attendance", "Participation"]);
    expect(b.done.map((i) => i.name)).toEqual(["Quiz 1"]);
  });

  it("counts are the lengths of the lists (nothing counted twice or dropped)", () => {
    const c = courseCounts(items, [done]);
    expect(c).toEqual({ pastDue: 1, upcoming: 2, notOpenYet: 2, passive: 2, done: 1 });
    expect(c.pastDue + c.upcoming + c.notOpenYet + c.passive + c.done).toBe(items.length + 1);
    expect(countsOf(courseBuckets(items, [done]))).toEqual(c);
  });

  it("the audit case: a course with ONLY passive items is 'nothing upcoming' AND '0 upcoming'", () => {
    const onlyPassive = [item({ passive: true }), item({ passive: true }), item({ passive: true })];
    const c = courseCounts(onlyPassive, []);
    expect(c.upcoming).toBe(0);
    expect(c.passive).toBe(3);
    expect(doNext(onlyPassive, [], [])).toBeNull();
  });

  it("'Nothing upcoming' and 'N upcoming' can never both be true (randomised fixtures)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 300; run++) {
      const list = Array.from({ length: Math.floor(rnd() * 8) }, () =>
        item({ passive: rnd() < 0.3, locked: rnd() < 0.2, status: rnd() < 0.3 ? "overdue" : "normal" }),
      );
      const ranked = list.filter(() => rnd() < 0.7).map((i) => i.canvasId);
      const c = courseCounts(list, []);
      const next = doNext(list, [], ranked);
      expect(next === null).toBe(c.pastDue + c.upcoming === 0);
      if (next) expect(next.passive || next.locked).toBeFalsy();
    }
  });
});

describe("importance order, and Do next = the top-ranked actionable item (past due included)", () => {
  const a = item({ name: "A", dueAt: "2026-10-01T12:00:00Z" });
  const b = item({ name: "B", dueAt: "2026-10-09T12:00:00Z" });
  const late = item({ name: "Late", status: "overdue", dueAt: "2026-09-20T12:00:00Z" });
  const unranked = item({ name: "Unranked", dueAt: "2026-09-30T12:00:00Z" });
  const passiveTop = item({ name: "Participation", passive: true });

  it("rows follow `rankedIds`, not name or due date; unranked sort after ranked (earliest due first)", () => {
    const bk = courseBuckets([a, b, unranked], [], [b.canvasId, a.canvasId]);
    expect(bk.upcoming.map((i) => i.name)).toEqual(["B", "A", "Unranked"]);
  });
  it("a past-due item ranked first IS Do next (the Focus rule: top priority no matter what)", () => {
    expect(doNext([a, b, late], [], [late.canvasId, b.canvasId, a.canvasId])?.name).toBe("Late");
  });
  it("otherwise the highest-ranked upcoming item wins over a lower-ranked past-due one", () => {
    expect(doNext([a, b, late], [], [b.canvasId, late.canvasId, a.canvasId])?.name).toBe("B");
  });
  it("a passive item is never Do next, even when it sorts first", () => {
    expect(doNext([passiveTop, a], [], [passiveTop.canvasId, a.canvasId])?.name).toBe("A");
  });
  it("Done lists the most recent first", () => {
    const old = item({ name: "Old", status: "done", dueAt: "2026-09-01T12:00:00Z" });
    const recent = item({ name: "Recent", status: "done", dueAt: "2026-09-25T12:00:00Z" });
    expect(courseBuckets([], [old, recent]).done.map((i) => i.name)).toEqual(["Recent", "Old"]);
  });
});

describe("done reasons", () => {
  it("each reason has the student's wording — and 'Date passed' says nothing was handed in", () => {
    expect(DONE_REASON_LABEL).toEqual({ submitted: "Submitted", graded: "Graded", manual: "Marked done by you", date_passed: "Date passed · not submitted" });
  });
  it("doneReason wins; items from before the field fall back to their own flags", () => {
    expect(doneReasonOf({ doneReason: "date_passed", manuallyDone: false, score: null })).toBe("date_passed");
    expect(doneReasonOf({ doneReason: "graded", manuallyDone: true, score: 9 })).toBe("graded");
    expect(doneReasonOf({ doneReason: undefined, manuallyDone: true, score: null })).toBe("manual");
    expect(doneReasonOf({ doneReason: undefined, manuallyDone: false, score: null })).toBe("submitted");
  });
  it("a missed quiz (date passed, nothing handed in) is NOT a completion: muted, never the success tone", () => {
    expect(doneRowView({ doneReason: "date_passed", manuallyDone: false, score: null })).toEqual({ reason: "date_passed", label: "Date passed · not submitted", tone: "missed" });
    for (const r of ["submitted", "graded", "manual"] as const) expect(doneRowView({ doneReason: r, manuallyDone: r === "manual", score: null }).tone).toBe("success");
  });
  it("once Canvas reports a score, a date-passed row becomes 'Graded' by the normal rule", () => {
    expect(doneRowView({ doneReason: "date_passed", manuallyDone: false, score: 7 })).toEqual({ reason: "graded", label: "Graded", tone: "success" });
  });
  it("CoursePage renders the missed row with a neutral marker and muted text — no green check, no strike", () => {
    const src = read("components/CoursePage.tsx");
    const row = src.slice(src.indexOf("function Row("));
    expect(row).toContain("const view = done ? doneRowView(item) : null;");
    const missedMarker = row.slice(row.indexOf('data-done="missed"'), row.indexOf("</span>", row.indexOf('data-done="missed"')));
    expect(missedMarker).not.toMatch(/success/);
    expect(missedMarker).toContain("text-muted");
    // the green check is only the success branch
    expect(row.indexOf('data-done="success"')).toBeGreaterThan(row.indexOf('data-done="missed"'));
    expect(row).toMatch(/\$\{missed \? "text-muted" : "text-success"\}`\}>\{view\.label\}/);
    expect(row).toMatch(/missed \? "text-muted" : done \? "text-muted line-through"/);
  });
});

describe("the course header adds up, and 'You're clear' only when it's true", () => {
  const items = [
    item({ status: "overdue" }),
    item(),
    item(),
    item({ locked: true }),
    item({ passive: true }),
  ];
  const done = [item({ status: "done", doneReason: "graded", score: 5 }), item({ status: "done", doneReason: "date_passed" })];
  it("every non-zero bucket is in the sentence and the numbers sum to all the course's items", () => {
    const parts = courseSummaryParts(courseCounts(items, done));
    expect(parts).toEqual(["1 past due", "2 upcoming", "1 not open yet", "1 graded by your teacher", "2 done"]);
    const sum = parts.reduce((n, p) => n + Number(p.split(" ")[0]), 0);
    expect(sum).toBe(items.length + done.length);
  });
  it("zero buckets are left out; an empty course says so", () => {
    expect(courseSummaryParts(courseCounts([item()], []))).toEqual(["1 upcoming"]);
    expect(courseSummaryParts(courseCounts([], []))).toEqual(["No work posted yet"]);
  });
  it("clear = nothing past due, upcoming or waiting to open (passive and done don't count)", () => {
    expect(isClear(courseCounts([item({ passive: true })], done))).toBe(true);
    expect(isClear(courseCounts([item({ status: "overdue" })], []))).toBe(false);
    expect(isClear(courseCounts([item({ locked: true })], []))).toBe(false);
  });
  it("CoursePage uses them: the header is courseSummaryParts; Upcoming hides when empty unless the course is clear", () => {
    const src = read("components/CoursePage.tsx");
    expect(src).toContain('{courseSummaryParts(counts).join(" · ")}');
    expect(src).toMatch(/\{\(counts\.upcoming > 0 \|\| isClear\(counts\)\) && <Section title="Upcoming"/);
    expect(src).toContain(`empty="You’re clear. Nothing to do right now."`);
    expect(src).not.toContain("Nothing upcoming. You're clear.");
  });
});

// ── Source guards ────────────────────────────────────────────────────────────
const read = (p: string) => readFileSync(p, "utf8");
/** Source without comments, so prose about a banned pattern doesn't trip a guard. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/ .*$/gm, "");
/** Quoted strings + JSX text — what a student can read — minus code-only values. */
function userStrings(p: string): string[] {
  const src = code(p)
    .replace(/^import .*$/gm, "")
    .replace(/(?:===|!==)\s*"[^"]*"/g, "") // status / kind comparisons
    .replace(/status: [^\n,]*/g, ""); // status values on item builders
  const strings = [...src.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2]);
  const jsxText = [...src.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]);
  return [...strings, ...jsxText]
    .map((t) => t.replace(/\$\{[^}]*\}/g, ""))
    .filter((t) => !/^[/@]/.test(t.trim()))
    .filter((t) => !/^[a-z0-9-_]+$/.test(t.trim()));
}

const OWNED = [
  "components/CourseGrid.tsx",
  "components/CourseCarousel.tsx",
  "components/CoursePage.tsx",
  "components/CourseExclude.tsx",
  "components/GradeCalculator.tsx",
  "components/GradePill.tsx",
  "components/ConnectionsForm.tsx",
  "components/SyncReportPanel.tsx",
  "components/GoogleCalendarCard.tsx",
  "components/LocalRelativeTime.tsx",
  "components/StudyView.tsx",
  "components/StudyTools.tsx",
  "components/studyUi.tsx",
  "components/DemoExperience.tsx",
  "lib/demoData.ts",
  "lib/gradeCalc.ts",
  "lib/courseGrade.ts",
  "lib/courseCounts.ts",
  "app/(app)/courses/page.tsx",
  "app/(app)/class/[courseId]/page.tsx",
  "app/(app)/study/page.tsx",
  "app/(app)/study/[canvasId]/page.tsx",
  "app/(app)/connections/page.tsx",
];

describe("dates: the student's zone, never the server's or the browser's", () => {
  it.each(OWNED)("%s has no ymd(new Date(…)) and no mount-time UTC swap", (f) => {
    const src = code(f);
    expect(src).not.toMatch(/ymd\(new Date\(/);
    expect(src).not.toMatch(/mounted \? undefined : "UTC"/);
  });
  it("every DueLabel in the course and study components is given the zone", () => {
    for (const f of ["components/CourseGrid.tsx", "components/CoursePage.tsx", "components/StudyView.tsx", "components/StudyTools.tsx"]) {
      const labels = code(f).match(/<DueLabel [^>]*>/g) ?? [];
      expect(labels.length, f).toBeGreaterThan(0);
      for (const l of labels) expect(l, f).toContain("timeZone={timeZone}");
    }
  });
  it("the course pages read today + zone from the data (lib/studentZone)", () => {
    expect(code("components/CourseGrid.tsx")).toContain("const timeZone = dataZone(data);");
    expect(code("components/CourseGrid.tsx")).toContain("const todayYmd = dataToday(data);");
    expect(code("components/CourseGrid.tsx")).toContain("relativeDay(meta.latestAnnouncement.postedAt, todayYmd, timeZone)");
    expect(code("components/CourseGrid.tsx")).not.toContain("useMounted");
    const route = code("app/(app)/class/[courseId]/page.tsx");
    expect(route).toContain("todayYmd={dataToday(data)}");
    expect(route).toContain("timeZone={dataZone(data)}");
  });
});

describe("one split: the card and the page both read lib/courseCounts", () => {
  it("CourseGrid counts and picks Do next through it (no local status filters)", () => {
    const src = code("components/CourseGrid.tsx");
    expect(src).toMatch(/import \{ courseBuckets, countsOf, doNext \} from "@\/lib\/courseCounts"/);
    expect(src).toContain("doNext(items, completed, rankedIds)");
    expect(src).toContain("{counts.upcoming} upcoming");
    expect(src).not.toMatch(/items\.filter\(\(it\) => it\.status ===/);
  });
  it("CoursePage lists its sections from it, in the agreed order, with done reasons", () => {
    const src = code("components/CoursePage.tsx");
    expect(src).toContain("courseBuckets(active, completed, rankedIds)");
    const order = ['title="Past due"', 'title="Upcoming"', 'title="Not open yet"', 'title="Graded by your teacher"', 'title="Done"'].map((t) => src.indexOf(t));
    for (const i of order) expect(i).toBeGreaterThan(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(src).toContain("{view.label}");
    expect(src).toMatch(/Opens <DueLabel iso=\{item\.unlockAt\}/);
  });
});

describe("wording canon: Course / Past due / study sessions", () => {
  it.each(OWNED)("%s: no 'class'/'classes' or 'overdue' a student can read", (f) => {
    for (const t of userStrings(f)) {
      expect(t, t).not.toMatch(/\bclass(es)?\b/i);
      expect(t, t).not.toMatch(/\boverdue\b/i);
    }
  });
  it("study pages say 'study sessions', never 'study blocks' or a bare 'sessions'", () => {
    for (const f of ["components/StudyView.tsx", "components/StudyTools.tsx", "components/studyUi.tsx"]) {
      for (const t of userStrings(f)) {
        expect(t, t).not.toMatch(/study blocks?/i);
        expect(t, t).not.toMatch(/(?<!study )\bsessions?\b/i);
      }
    }
  });
  it("the sparse-material note matches what the AI is told (title, description AND the subject), no hedge", () => {
    const tools = code("components/StudyTools.tsx");
    expect(tools).toContain("built from its title, description and the subject.");
    expect(tools).not.toContain("Check coverage with your teacher");
    // …because the low-material prompt tells the model to use the subject itself
    expect(read("lib/study.ts").replace(/"\s*\+\s*"/g, "")).toContain("general knowledge of the field");
  });
});

describe("study sessions only through the one rule (lib/studyWeek.isStudySessionBlock)", () => {
  it.each(OWNED)("%s never reads a block's `.study` flag directly", (f) => {
    expect(code(f)).not.toMatch(/\b\w+\.study\b(?!\w)/);
  });
  it("the Study pages build their sessions with lib/study.studySessionsFor (which delegates to the rule)", () => {
    for (const f of ["app/(app)/study/page.tsx", "app/(app)/study/[canvasId]/page.tsx"]) expect(code(f)).toContain("studySessionsFor(data.plan");
    expect(read("lib/study.ts")).toMatch(/isStudySessionBlock\(b, todayYmd, zone\)/);
  });
});

describe("Last checked Canvas: one freshness line, one timestamp", () => {
  const page = code("app/(app)/connections/page.tsx");
  const form = code("components/ConnectionsForm.tsx");
  const panel = code("components/SyncReportPanel.tsx");
  const google = code("components/GoogleCalendarCard.tsx");
  it("the page computes ONE lastCheckedAt (latest run of any kind) and passes it to both cards", () => {
    expect(page).toContain("const lastCheckedAt = lastCheckedAtOf(cred);");
    expect(page).toContain('import { lastCheckedAtOf } from "@/lib/lastChecked";');
    expect(page).toMatch(/lastCheckedAt,\n/);
    expect(page).toContain("<SyncReportPanel report={syncReport} lastCheckedAt={lastCheckedAt} />");
  });
  it("the Canvas card says 'Last checked Canvas …' and nothing about 'Last synced' / 'Checked'", () => {
    expect(form).toMatch(/Last checked Canvas <LocalRelativeTime iso=\{initial\.lastCheckedAt\} \/>/);
    expect(form).not.toMatch(/Last synced|· Checked|lastValidatedAt/);
  });
  it("the sync card is titled 'Last check' and shows that same timestamp", () => {
    expect(panel).toContain(">Last check</span>");
    expect(panel).toContain("<LocalRelativeTime iso={lastCheckedAt} />");
    expect(panel).not.toContain("Last sync<");
  });
  it("Google Calendar uses the same relative formatter and 'Last checked'", () => {
    expect(google).toContain('<dt className="text-muted">Last checked Google</dt>');
    expect(google).toContain("<LocalRelativeTime iso={syncedAt} />");
    expect(google).not.toMatch(/toLocaleString|"never"/);
  });
});

describe("lastCheckedAtOf — THE freshness timestamp", () => {
  it("prefers the latest run of any kind (the sync report), else the last full sync, else null", async () => {
    const { lastCheckedAtOf } = await import("@/lib/lastChecked");
    const { parseSyncReport } = await import("@/lib/syncReport");
    const synced = new Date("2026-09-28T10:00:00Z");
    expect(lastCheckedAtOf(null)).toBeNull();
    expect(lastCheckedAtOf({ lastSyncReport: null, syncedAt: null })).toBeNull();
    expect(lastCheckedAtOf({ lastSyncReport: null, syncedAt: synced })).toBe(synced.toISOString());
    const report = { version: 1, at: "2026-09-28T12:30:00.000Z", mode: "quick", ok: true, status: "valid", courses: [], skippedNonStudent: 0 };
    expect(parseSyncReport(report)?.at).toBe("2026-09-28T12:30:00.000Z"); // a valid report
    expect(lastCheckedAtOf({ lastSyncReport: report, syncedAt: synced })).toBe("2026-09-28T12:30:00.000Z");
    expect(lastCheckedAtOf({ lastSyncReport: { garbled: true }, syncedAt: synced })).toBe(synced.toISOString());
  });
  it("LocalRelativeTime renders on the viewer's clock only (after mount), never a server-zone date", () => {
    const src = code("components/LocalRelativeTime.tsx");
    expect(src).toContain("const mounted = useMounted();");
    expect(src).toContain('{mounted ? relativeTime(iso) : "…"}');
    expect(src).not.toContain("suppressHydrationWarning");
  });
});
