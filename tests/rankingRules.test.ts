// The owner's ranking rules (2026-09-28): tiebreak chain, the unknown-late-policy
// decay, unopened + passive items at 0 at the bottom, Focus including past-due
// work, days in the student's zone, the one done rule, and the thin-course share.

import { describe, it, expect } from "vitest";
import {
  rankItems,
  scoreItem,
  sameImportance,
  compareTiebreak,
  isZeroImportance,
  type TieKey,
  unknownLateFactor,
  UNKNOWN_LATE_FULL_DAYS,
  UNKNOWN_LATE_HALF_DAYS,
  UNKNOWN_LATE_HALF_FRACTION,
  type MarginalInput,
} from "@/lib/marginalPriority";
import { rankActiveRows, courseTotalPoints, fallbackGradeShares, focusSlice, type RankableRow } from "@/lib/rankActive";
import { assignmentDoneReason, isAssignmentDone } from "@/lib/assignmentStatus";
import { dayDiffInZone } from "@/lib/studentZone";
import { TYPE_PROXY_WEIGHT } from "@/lib/gradeWeight";
import type { LatePolicy } from "@/lib/latePolicy";

const NY = "America/New_York";
const NONE: LatePolicy = { kind: "none", value: 0 };
const PERDAY10: LatePolicy = { kind: "perday", value: 0.1 };
const FLAT0: LatePolicy = { kind: "flat", value: 0 }; // accepted late, no penalty

function mk(o: Partial<MarginalInput> & { canvasId: number }): MarginalInput {
  return {
    name: `A${o.canvasId}`,
    courseName: "C",
    kind: "assignment",
    weight: 0.1,
    courseGrade: null,
    dueInDays: 3,
    dueAtMs: 1_000,
    effortHours: 2,
    latePolicy: NONE,
    submitted: false,
    ...o,
  };
}
const order = (items: MarginalInput[]) => rankItems(items).map((r) => r.canvasId);
const val = (i: MarginalInput) => scoreItem(i).value;

describe("tiebreak chain", () => {
  it("natural name order: 'Prep 2' before 'Prep 10'", () => {
    expect(order([mk({ canvasId: 1, name: "Prep 10" }), mk({ canvasId: 2, name: "Prep 2" })])).toEqual([2, 1]);
  });

  it("importance equal to 5 significant digits is a TIE → earlier due date wins", () => {
    const a = mk({ canvasId: 1, weight: 0.1000001, dueAtMs: 5_000 }); // a hair more value, later
    const b = mk({ canvasId: 2, weight: 0.1, dueAtMs: 4_000 }); // earlier due
    expect(sameImportance(val(a), val(b))).toBe(true);
    expect(order([a, b])).toEqual([2, 1]);
  });

  it("a difference inside 5 significant digits is NOT a tie → importance decides", () => {
    const a = mk({ canvasId: 1, weight: 0.10002, dueAtMs: 5_000 });
    const b = mk({ canvasId: 2, weight: 0.1, dueAtMs: 4_000 });
    expect(sameImportance(val(a), val(b))).toBe(false);
    expect(order([a, b])).toEqual([1, 2]);
  });

  it("same importance + same due → the bigger share of grade wins", () => {
    // 0.1 share × leverage 0.2 = 0.2 share × leverage 0.1
    const small = mk({ canvasId: 1, name: "a", weight: 0.1, courseGrade: 0.8 });
    const big = mk({ canvasId: 2, name: "b", weight: 0.2, courseGrade: 0.9 });
    expect(sameImportance(val(small), val(big))).toBe(true);
    expect(order([small, big])).toEqual([2, 1]);
  });

  it("same importance, due and share → the LOWER course grade wins", () => {
    // both grades hit the leverage floor → identical importance
    const a = mk({ canvasId: 1, name: "a", courseGrade: 0.97 });
    const b = mk({ canvasId: 2, name: "b", courseGrade: 0.92 });
    expect(val(a)).toBe(val(b));
    expect(order([a, b])).toEqual([2, 1]);
  });

  it("unknown course grade goes after a known one; then canvasId", () => {
    const unknown = mk({ canvasId: 1, name: "same", courseGrade: null, passive: true });
    const known = mk({ canvasId: 2, name: "same", courseGrade: 0.95, passive: true });
    expect(order([unknown, known])).toEqual([2, 1]);
    expect(order([mk({ canvasId: 9, name: "x", passive: true }), mk({ canvasId: 3, name: "x", passive: true })])).toEqual([3, 9]);
  });
});

describe("past-due decay: unknown vs known late policies", () => {
  const at = (latePolicy: LatePolicy | null, dueInDays: number) => val(mk({ canvasId: 1, weight: 0.2, latePolicy, dueInDays }));
  const atDue = at(null, 0); // importance at the due date (urgency at its maximum)

  it("exports the schedule as named constants", () => {
    expect([UNKNOWN_LATE_FULL_DAYS, UNKNOWN_LATE_HALF_DAYS, UNKNOWN_LATE_HALF_FRACTION]).toEqual([2, 4, 0.5]);
    expect([1, 2, 3, 4, 5, 9].map(unknownLateFactor)).toEqual([1, 1, 0.5, 0.5, 0, 0]);
  });

  it("UNKNOWN (null): days late 1–2 full, 3–4 half, ≥5 zero", () => {
    expect(atDue).toBeGreaterThan(0);
    expect(at(null, -1)).toBeCloseTo(atDue, 12);
    expect(at(null, -2)).toBeCloseTo(atDue, 12);
    expect(at(null, -3)).toBeCloseTo(atDue * 0.5, 12);
    expect(at(null, -4)).toBeCloseTo(atDue * 0.5, 12);
    expect(at(null, -5)).toBe(0);
  });

  it('KNOWN "none": 0 from the first day late', () => {
    for (const d of [-1, -2, -3, -4, -5]) expect(at(NONE, d)).toBe(0);
  });

  it("KNOWN per-day: the salvage × OVERDUE_FRACTION curve, bleeding each day", () => {
    const v = [-1, -2, -3, -4, -5].map((d) => at(PERDAY10, d));
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeLessThan(v[i - 1]);
    expect(v[0] / v[4]).toBeCloseTo(0.9 / 0.5, 9); // salvage 0.9 on day 1, 0.5 on day 5
  });

  it("KNOWN flat-0 (accepted, no penalty): full salvage every day", () => {
    const v = [-1, -2, -3, -4, -5].map((d) => at(FLAT0, d));
    expect(new Set(v).size).toBe(1);
    expect(v[0]).toBeGreaterThan(0);
  });

  it("an unknown-policy item 5+ days late stays LISTED, at the bottom", () => {
    const dead = mk({ canvasId: 1, name: "late", dueInDays: -6, latePolicy: null, weight: 0.5 });
    const undated = mk({ canvasId: 2, name: "undated", dueInDays: null, dueAtMs: null });
    expect(order([dead, undated])).toEqual([2, 1]);
  });
});

// ---- rankActiveRows (rows → ranked, reasons, Focus) ----
const NOW = new Date("2026-09-28T16:00:00Z"); // Mon Sep 28, 12:00 in New York
function row(o: Partial<RankableRow> & { canvasId: number }): RankableRow {
  return {
    name: `A${o.canvasId}`,
    courseName: "C",
    courseCanvasId: 1,
    dueAt: new Date("2026-10-02T03:59:00Z"),
    pointsPossible: 10,
    htmlUrl: null,
    submissionType: "online_upload",
    estimatedEffortHours: 1,
    gradeWeight: 0.05,
    ...o,
  };
}
const rank = (rows: RankableRow[], zone = NY) =>
  rankActiveRows(rows, courseTotalPoints(rows.map((r) => ({ courseCanvasId: r.courseCanvasId, pointsPossible: r.pointsPossible }))), 2, NOW, zone);

describe("unopened and passive: listed at importance 0, at the bottom", () => {
  const rows = [
    row({ canvasId: 1, name: "Locked essay", gradeWeight: 0.4, unlockAt: new Date("2026-10-03T14:00:00Z") }),
    row({ canvasId: 2, name: "Participation", type: "other", submissionType: "none", requiresAction: false, gradeWeight: 0.3 }),
    row({ canvasId: 3, name: "Undated reading", dueAt: null }),
    row({ canvasId: 4, name: "Dated homework" }),
  ];
  const ranked = rank(rows);

  it("orders dated > undated > zero-importance (locked, passive)", () => {
    expect(ranked.map((r) => r.canvasId)).toEqual([4, 3, 1, 2]); // zeros ordered by share: 0.4 before 0.3
    expect(ranked.find((r) => r.canvasId === 1)).toMatchObject({ value: 0, score: 0, locked: true });
    expect(ranked.find((r) => r.canvasId === 2)).toMatchObject({ value: 0, score: 0, passive: true });
  });

  it("says why, in the date-label words", () => {
    const reason = (id: number) => ranked.find((r) => r.canvasId === id)!.reason;
    expect(reason(1)).toBe("Opens Oct 3 · 10 pts");
    expect(reason(2)).toBe("Graded by your teacher");
    expect(reason(3)).toBe("No due date · 10 pts");
    expect(reason(4)).toBe("Due Thursday · 10 pts");
  });

  it("never reaches Focus", () => {
    expect(focusSlice(ranked).map((r) => r.canvasId)).toEqual([4, 3]);
  });
});

describe("Focus = the top of the ranking, past due included", () => {
  it("an unknown-policy item 1 day late ranks #1 and leads Focus", () => {
    const ranked = rank([
      row({ canvasId: 1, name: "Late lab", dueAt: new Date("2026-09-27T20:00:00Z"), gradeWeight: 0.2, pointsPossible: 70 }),
      row({ canvasId: 2, name: "Upcoming", gradeWeight: 0.05 }),
    ]);
    expect(ranked[0].canvasId).toBe(1);
    expect(ranked[0].reason).toBe("Past due · 70 pts");
    expect(focusSlice(ranked)[0].canvasId).toBe(1);
  });
});

describe("days until due are read in the student's zone", () => {
  const due = new Date("2026-10-01T03:59:00Z"); // Wed Sep 30, 11:59 PM in New York

  it("is 2 days in America/New_York (3 in UTC)", () => {
    expect(dayDiffInZone(due, NY, NOW)).toBe(2);
    expect(dayDiffInZone(due, "UTC", NOW)).toBe(3);
  });

  it("the urgency cliff fires on the student's day, and the reason says so", () => {
    const [ny] = rank([row({ canvasId: 1, dueAt: due, pointsPossible: 70 })], NY);
    const [utc] = rank([row({ canvasId: 1, dueAt: due, pointsPossible: 70 })], "UTC");
    expect(ny.value!).toBeGreaterThan(utc.value! * 5); // still imminent in NY, past the cliff in UTC
    expect(ny.reason).toBe("Due Wednesday · 70 pts");
  });

  it("tomorrow / exams use the same words", () => {
    const [t] = rank([row({ canvasId: 1, dueAt: new Date("2026-09-30T03:00:00Z"), pointsPossible: 70 })]);
    expect(t.reason).toBe("Due tomorrow · 70 pts");
    const [e] = rank([row({ canvasId: 2, name: "Exam 1", type: "exam", dueAt: new Date("2026-09-30T03:00:00Z"), pointsPossible: 100 })]);
    expect(e.reason).toBe("Exam tomorrow · 100 pts");
  });
});

describe("done — the one rule", () => {
  const ctx = (type: "quiz" | "exam" | "assignment", dueAt: Date | null) => ({ type, dueAt, zone: NY, now: NOW });
  const base = { manualDoneAt: null, submittedAt: null as Date | null, submissionState: null as string | null };

  it("graded counts as done even without a submission time", () => {
    expect(assignmentDoneReason({ ...base, submissionState: "graded" })).toBe("graded");
  });

  it("a quiz dated yesterday (in the zone) is done: date_passed", () => {
    // Sep 28 03:30Z = Sep 27, 11:30 PM in New York → yesterday there (today in UTC)
    const y = new Date("2026-09-28T03:30:00Z");
    expect(assignmentDoneReason(base, ctx("quiz", y))).toBe("date_passed");
    expect(isAssignmentDone(base, { ...ctx("quiz", y), zone: "UTC" })).toBe(false);
  });

  it("a quiz dated today is not done", () => {
    expect(isAssignmentDone(base, ctx("quiz", new Date("2026-09-28T23:00:00Z")))).toBe(false);
  });

  it("an assignment dated yesterday is not done by date", () => {
    expect(isAssignmentDone(base, ctx("assignment", new Date("2026-09-27T15:00:00Z")))).toBe(false);
  });

  it("a reopened submission stays active", () => {
    expect(isAssignmentDone({ ...base, submittedAt: new Date("2026-09-20T00:00:00Z"), submissionState: "unsubmitted" }, ctx("assignment", null))).toBe(false);
  });

  it("a manual check wins over everything", () => {
    const r = { manualDoneAt: new Date(), submittedAt: new Date(), submissionState: "graded" };
    expect(assignmentDoneReason(r, ctx("quiz", new Date("2026-09-01T00:00:00Z")))).toBe("manual");
  });
});

describe("thin-course share", () => {
  it("a course with one pointed item posted never gives it the whole grade", () => {
    const only = row({ canvasId: 1, gradeWeight: null, pointsPossible: 100 });
    const proxy = row({ canvasId: 1, gradeWeight: TYPE_PROXY_WEIGHT.assignment, pointsPossible: 100 });
    expect(rank([only])[0].value).toBeCloseTo(rank([proxy])[0].value!, 12);
  });

  it("with ≥ 5 pointed items posted, the posted-points share applies", () => {
    const rows = [1, 2, 3, 4, 5].map((id) => row({ canvasId: id, gradeWeight: null, pointsPossible: 20 })); // 20/100 = 0.2 each
    const withShare = rank([row({ canvasId: 1, gradeWeight: 0.2, pointsPossible: 20 })])[0].value!;
    expect(rank(rows).find((r) => r.canvasId === 1)!.value).toBeCloseTo(withShare, 12);
  });

  it("the course-level fallback (quick-sync rows) follows the same thin rule", () => {
    const shares = fallbackGradeShares(
      [{ canvasId: 1, courseCanvasId: 7, name: "Problem set", pointsPossible: 100, groupId: null, groupName: null, groupWeight: null, type: "assignment" }],
      new Map(),
    );
    expect(shares.get(1)).toBe(TYPE_PROXY_WEIGHT.assignment);
  });
});

describe("no jump when a deadline passes (orchestrator's call, 2026-09-28)", () => {
  const v = (latePolicy: LatePolicy | null, dueInDays: number) => val(mk({ canvasId: 1, weight: 0.2, latePolicy, dueInDays }));
  const cases: [string, LatePolicy | null][] = [
    ["unknown", null],
    ["none", NONE],
    ["flat 0.5", { kind: "flat", value: 0.5 }],
    ["flat 0 (no penalty)", FLAT0],
  ];
  for (const [label, p] of cases) {
    it(`${label}: the day before it's due ≥ the day after`, () => {
      expect(v(p, 1)).toBeGreaterThanOrEqual(v(p, -1));
    });
  }
  it("no-penalty upcoming work is not ranked like undated backfill", () => {
    expect(v(FLAT0, 1)).toBeGreaterThan(v(FLAT0, null as unknown as number) * 10);
  });
  // KNOWN CONFLICT (reported, not decided here): a small-penalty policy (per-day 10%,
  // flat 20%) is worth 0.118 / 0.216 × weight the day before and 0.45 / 0.40 the
  // day after. Flooring it would break acceptance Q11's "no-credit > 3× forgiving".
  it.todo("per-day / flat < 1/3: the day before it's due ≥ the day after (conflicts with Q11 ×3)");
});


describe("the ranking is a strict total order (review, 2026-09-28)", () => {
  // Deterministic PRNG so the test is reproducible.
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const r = rng(42);
  const items: MarginalInput[] = Array.from({ length: 200 }, (_, k) => {
    const kind = k % 7;
    return mk({
      canvasId: 1000 - k, // canvasId order ≠ input order
      name: `Prep ${k % 13}`, // lots of equal names
      courseName: `Course ${k % 3}`,
      courseId: k % 3,
      points: [0, 30, 100, null][k % 4],
      weight: kind === 0 ? 0 : [0.05, 0.1, 0.1000001][k % 3], // zero-share + 5-sig-digit ties
      courseGrade: [null, 0.95, 0.72][k % 3],
      dueInDays: kind === 1 ? null : kind === 2 ? -6 : [1, 3, 10][k % 3], // undated, dead unknown-late, dated
      dueAtMs: kind === 1 ? null : [1_000, 2_000, 3_000][k % 3],
      latePolicy: kind === 2 ? null : NONE,
      passive: kind === 3 && k % 2 === 0,
      locked: kind === 4 && k % 2 === 0,
    });
  });
  const shuffle = (a: MarginalInput[]) => {
    const b = [...a];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };

  it("25 shuffles of a 200-item mixed list → the identical order every time", () => {
    const first = order(items);
    for (let t = 0; t < 25; t++) expect(order(shuffle(items))).toEqual(first);
  });

  it("the review's 3-item cycle is gone (dated vs undated zero items)", () => {
    const k = (canvasId: number, dueAtMs: number | null, share: number, name: string): TieKey => ({ canvasId, name, dueAtMs, share, courseGrade: null });
    const A = k(1, 2_000, 0.1, "a");
    const B = k(2, null, 0.3, "b");
    const C = k(3, 1_000, 0.05, "c");
    const lt = (x: TieKey, y: TieKey) => compareTiebreak(x, y) < 0;
    expect([lt(C, A), lt(A, B), lt(C, B)]).toEqual([true, true, true]); // C < A < B, transitive
  });
});

describe("done rule: a reopened quiz stays active after its date", () => {
  it("submittedAt set + 'unsubmitted' skips the date rule", () => {
    const reopened = { manualDoneAt: null, submittedAt: new Date("2026-09-20T00:00:00Z"), submissionState: "unsubmitted" };
    const ctx = { type: "quiz" as const, dueAt: new Date("2026-09-25T15:00:00Z"), zone: NY, now: NOW };
    expect(assignmentDoneReason(reopened, ctx)).toBeNull();
  });
});

describe("an exam/quiz whose time has passed today scores 0 (review, 2026-09-28)", () => {
  // NOW = Mon Sep 28, 12:00 PM in New York; the quiz was at 9 AM that day.
  const quiz = row({ canvasId: 1, name: "Quiz 3", type: "quiz", dueAt: new Date("2026-09-28T13:00:00Z"), pointsPossible: 20, gradeWeight: 0.2 });
  const later = row({ canvasId: 2, name: "Quiz 4", type: "quiz", dueAt: new Date("2026-09-28T23:00:00Z"), pointsPossible: 20, gradeWeight: 0.2 });
  const other = row({ canvasId: 3, gradeWeight: 0.01 });

  it("not done yet (the day rule), but importance 0, 'Earlier today', never Focus", () => {
    expect(isAssignmentDone({ submittedAt: null, submissionState: null }, { type: "quiz", dueAt: quiz.dueAt, zone: NY, now: NOW })).toBe(false);
    const ranked = rank([quiz, later, other]);
    const q = ranked.find((r) => r.canvasId === 1)!;
    expect(isZeroImportance(q)).toBe(true);
    expect(q.reason).toBe("Earlier today · 20 pts");
    expect(ranked[ranked.length - 1].canvasId).toBe(1);
    expect(focusSlice(ranked).map((r) => r.canvasId)).not.toContain(1);
  });

  it("a quiz later today still counts, and reads 'Quiz today'", () => {
    const l = rank([later])[0];
    expect(isZeroImportance(l)).toBe(false);
    expect(l.reason).toBe("Quiz today · 20 pts");
  });
});

describe("'points' tiebreak inside one thin course (review, 2026-09-28)", () => {
  it("(b) same share (thin-course default) → higher raw points first, same course only", () => {
    const rows = [
      row({ canvasId: 1, name: "Busywork", gradeWeight: null, pointsPossible: 0 }),
      row({ canvasId: 2, name: "Worksheet", gradeWeight: null, pointsPossible: 30 }),
      row({ canvasId: 3, name: "Essay", gradeWeight: null, pointsPossible: 100 }),
    ];
    expect(rank(rows).map((r) => r.canvasId)).toEqual([3, 2, 1]);
  });

  it("(b) across courses, points never decide (not comparable) — the course groups them first", () => {
    const a = mk({ canvasId: 1, name: "x", courseName: "Bio", courseId: 1, points: 5 });
    const b = mk({ canvasId: 2, name: "x", courseName: "Art", courseId: 2, points: 500 });
    const c = mk({ canvasId: 3, name: "x", courseName: "Bio", courseId: 1, points: 50 });
    expect(order([a, b, c])).toEqual([2, 3, 1]); // Art, then Bio by points
  });

  it("(a) a 0-point item's share is 0 → importance 0, at the bottom, never Focus", () => {
    // Sync stores gradeShareFor's answer on Assignment.gradeWeight; a 0-/no-point item gets 0.
    const ranked = rank([
      row({ canvasId: 1, name: "Busywork", gradeWeight: 0, pointsPossible: 0 }),
      row({ canvasId: 2, name: "Essay", gradeWeight: 0.06, pointsPossible: 100, dueAt: null }),
    ]);
    expect(ranked.map((r) => r.canvasId)).toEqual([2, 1]);
    expect(isZeroImportance(ranked[1])).toBe(true);
    expect(focusSlice(ranked).map((r) => r.canvasId)).toEqual([2]);
  });
});
