// #135 Plan list + THE Focus list (lib/planFocus over lib/rankActive.focusSlice),
// #143 study sessions, #136 effort-once and student-zone dates across the
// Plan/Dashboard/Calendar/Timeline files. Grouping, Focus, the reason helper and
// the check-off behaviour are pure and behaviour-tested; the rest are intent-level
// source guards so "EVERYTHING SHOULD AGREE EVERYWHERE" can't quietly regress.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  focusItems,
  focusOrderOf,
  groupPlanItems,
  orderDuringUndo,
  planGroupOf,
  planListView,
  planRanks,
  reasonDetail,
  PLAN_GROUPS,
} from "@/lib/planFocus";
import { focusSlice } from "@/lib/rankActive";
import { applyToggle, clearPending, settle, type PendingMap } from "@/lib/pendingDone";
import type { CalendarItem } from "@/lib/calendarData";
import type { ScoredAssignment } from "@/lib/priority";

type Fx = Pick<CalendarItem, "canvasId" | "status" | "dueAt"> & Partial<Pick<CalendarItem, "locked" | "passive" | "name" | "reason">>;
const DUE = "2026-10-02T03:59:00.000Z";
const item = (canvasId: number, p: Partial<Fx> = {}): Fx => ({ canvasId, status: "normal", dueAt: DUE, name: `#${canvasId}`, ...p });
const sc = (canvasId: number, value: number, p: Partial<ScoredAssignment> = {}) => ({ canvasId, value, score: value, ...p }) as ScoredAssignment;

// Importance order (the engine's contract): past due ranks in with its decayed
// importance; locked and passive sit at the bottom with importance 0.
const items: Fx[] = [
  item(1), // do next
  item(2, { status: "overdue" }), // past due
  item(3, { dueAt: null }), // no due date
  item(4, { locked: true }), // not open yet
  item(5, { passive: true, dueAt: "2026-09-20T12:00:00.000Z" }), // an OLD participation grade — never past due (the scheduler skips it)
  item(6, { status: "done" }), // finished — never listed
  item(7, { status: "overdue" }), // past due
  item(8), // unranked (not analysed yet) — goes last
];
const ranked = [sc(2, 9), sc(1, 7), sc(7, 4), sc(3, 3), sc(6, 2), sc(5, 0, { passive: true }), sc(4, 0, { locked: true })];
const order = focusSlice(ranked, Infinity).map((r) => r.canvasId); // what the pages pass

describe("groupPlanItems — five groups, importance order inside, GLOBAL rank numbers", () => {
  const g = groupPlanItems(items, ranked);
  const view = g.groups.map((x) => [x.key, x.rows.map((r) => [r.item.canvasId, r.rank])]);

  it("groups in the owner's order; teacher-graded items at the bottom, never in Do next", () => {
    expect(view).toEqual([
      ["pastDue", [[2, 1], [7, 3]]], // #3 visibly sits in Past due
      ["doNext", [[1, 2], [8, 7]]], // unranked last
      ["notOpen", [[4, 6]]],
      ["noDate", [[3, 4]]],
      ["teacher", [[5, 5]]],
    ]);
  });
  it("labels are the owner's wording", () => {
    expect(PLAN_GROUPS.map((x) => x.label)).toEqual(["Past due", "Do next", "Not open yet", "No due date", "Graded by your teacher"]);
  });
  it("done items never appear; ranks run 1..N with no gaps", () => {
    const all = g.groups.flatMap((x) => x.rows);
    expect(all.some((r) => r.item.canvasId === 6)).toBe(false);
    expect(all.map((r) => r.rank).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("'N to do' counts only what the student can act on (not Not-open-yet, not teacher-graded)", () => {
    expect(g.toDo).toBe(5); // past due 2 + do next 2 + no due date 1
    expect(g.pastDue).toBe(2);
  });
  it("empty groups don't render", () => {
    expect(groupPlanItems([item(1), item(2)], [sc(1, 1), sc(2, 1)]).groups.map((x) => x.key)).toEqual(["doNext"]);
    expect(groupPlanItems([], []).groups).toEqual([]);
  });
  it("membership: teacher-graded beats everything, then Not open yet, then past due, then undated", () => {
    expect(planGroupOf(item(1, { passive: true, status: "overdue", locked: true }))).toBe("teacher");
    expect(planGroupOf(item(1, { locked: true, status: "overdue" }))).toBe("notOpen");
    expect(planGroupOf(item(1, { locked: true, dueAt: null }))).toBe("notOpen");
    expect(planGroupOf(item(1, { status: "overdue", dueAt: null }))).toBe("pastDue");
    expect(planGroupOf(item(1, { dueAt: null }))).toBe("noDate");
  });
  it("planRanks gives the Timeline the same numbers the list prints", () => {
    const r = planRanks(items, ranked);
    for (const grp of g.groups) for (const row of grp.rows) expect(r.get(row.item.canvasId)).toBe(row.rank);
  });
});

describe("THE Focus list — the ranking module's focusSlice, mapped onto the items on screen", () => {
  it("a past-due #1 IS the Focus (the owner: 'the top priority no matter what that is')", () => {
    expect(focusItems(items, order, 1).map((i) => i.canvasId)).toEqual([2]);
  });
  it("the rows beneath include past due too; locked / passive / zero importance / done never appear", () => {
    expect(focusItems(items, order, Infinity).map((i) => i.canvasId)).toEqual([2, 1, 7, 3]); // #6 is done on screen
    expect(focusItems(items, order, 2).map((i) => i.canvasId)).toEqual([2, 1]);
  });
  it("data.recommendations (focusSlice's first TOP_N) is the head of the same list, and the fallback", () => {
    const recs = focusSlice(ranked);
    expect(order.slice(0, recs.length)).toEqual(recs.map((r) => r.canvasId));
    expect(focusOrderOf({ recommendations: recs })).toEqual(recs.map((r) => r.canvasId));
    expect(focusOrderOf({ recommendations: recs }, [9, 8])).toEqual([9, 8]);
  });
  it("nothing actionable → no Focus", () => {
    expect(focusItems([item(4, { locked: true }), item(5, { passive: true })], focusSlice(ranked, Infinity).map((r) => r.canvasId), 1)).toEqual([]);
  });
});

describe("reasonDetail — the row states its date once (right edge); the reason keeps the rest", () => {
  it.each([
    ["Due tomorrow · 70 pts", "70 pts"],
    ["Due Wednesday · 70 pts", "70 pts"],
    ["Exam Oct 7 · 100 pts", "100 pts"],
    ["Quiz today", null],
    ["Past due · 70 pts", "70 pts"],
    ["Opens Oct 3 · 20 pts", "20 pts"],
    ["No due date", null],
    ["Graded by your teacher", "Graded by your teacher"],
    ["Due in 2 days · 70 pts · 1.5h won't fit", "70 pts · 1.5h won't fit"],
    ["12% of grade · 40 pts", "12% of grade · 40 pts"],
  ])("%s → %s", (reason, want) => {
    expect(reasonDetail(reason)).toBe(want);
  });
  it("empty in, null out", () => {
    expect(reasonDetail(null)).toBeNull();
    expect(reasonDetail("")).toBeNull();
  });
});

describe("check-off behaviour (planListView + orderDuringUndo)", () => {
  const listItems = [item(1), item(2, { status: "overdue" }), item(3)];
  const r0 = [sc(2, 9), sc(1, 7), sc(3, 1)];
  const o0 = focusSlice(r0, Infinity).map((r) => r.canvasId);
  const rowsOf = (v: ReturnType<typeof planListView<Fx>>) => v.groups.map((g) => [g.key, g.rows.map((r) => [r.item.canvasId, r.rank])]);
  const before = planListView({ items: listItems, ranked: r0, focusOrder: o0, pending: new Map() });

  it("a checked row keeps its place, group and number — even after a refresh drops it — and the counts hold", () => {
    const pending: PendingMap<Fx> = applyToggle(new Map(), 2, true, listItems[1]);
    const frozen = { ranked: r0, focusOrder: o0 };
    // The server has recorded it: it's gone from the fresh items and the ranking.
    const fresh = { ranked: [sc(1, 7), sc(3, 1)], focusOrder: [1, 3] };
    const o = orderDuringUndo(pending, frozen, fresh);
    const during = planListView({ items: [listItems[0], listItems[2]], ranked: o.ranked, focusOrder: o.focusOrder, pending });
    expect(rowsOf(during)).toEqual(rowsOf(before));
    expect([during.toDo, during.pastDue, during.focusId]).toEqual([before.toDo, before.pastDue, before.focusId]);
  });
  it("once the window closes the row counts as done (and the live order returns)", () => {
    const settled = settle(applyToggle(new Map(), 2, true, listItems[1]), 2);
    expect(orderDuringUndo(settled, { ranked: r0 }, { ranked: [] })).toEqual({ ranked: [] });
    const after = planListView({ items: listItems, ranked: r0, focusOrder: o0, pending: settled });
    expect([after.toDo, after.pastDue]).toEqual([before.toDo - 1, before.pastDue - 1]);
  });
  it("Undo restores the list exactly", () => {
    const undone = clearPending(applyToggle(new Map(), 2, true, listItems[1]), 2);
    const v = planListView({ items: listItems, ranked: r0, focusOrder: o0, pending: undone });
    expect([rowsOf(v), v.toDo, v.pastDue, v.focusId]).toEqual([rowsOf(before), before.toDo, before.pastDue, before.focusId]);
  });
});

// ── Source guards (intent-level) ────────────────────────────────────────────────
const read = (p: string) => readFileSync(p, "utf8");
const stripComments = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/\s.*$/gm, "");
const MINE = [
  "components/PlanSurface.tsx",
  "components/DashboardView.tsx",
  "components/CalendarView.tsx",
  "components/TimelineView.tsx",
  "components/calendar/parts.tsx",
  "components/StudyWeekStrip.tsx",
  "components/SyncStatus.tsx",
  "components/useAutoSync.ts",
  "app/(app)/dashboard/page.tsx",
  "app/(app)/plan/page.tsx",
];
/** User-facing strings: string/template literals and JSX text (not imports, paths, ids). */
function userFacing(src: string): string[] {
  // The status literal "overdue" is code (CalendarItem.status), not copy.
  const s = stripComments(src).replace(/^import .*$/gm, "").replace(/"overdue"/g, '""');
  const strings = [...s.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2]);
  const jsxText = [...s.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]);
  return [...strings, ...jsxText]
    .map((t) => t.replace(/\$\{[^}]*\}/g, ""))
    .filter((t) => !/^[/@]/.test(t.trim()))
    .filter((t) => !/^[a-z0-9-]+$/.test(t.trim()));
}

describe("#143 — one study-session rule, one day rule, in every file of this surface", () => {
  for (const f of MINE) {
    it(`${f}: no raw block.study reads, no runtime-zone day reads, no mount swap`, () => {
      const code = stripComments(read(f));
      expect(code).not.toMatch(/\bb\.study\b/);
      expect(code).not.toMatch(/\(\(?\w+\)? => !*\w+\.study\)/);
      expect(code).not.toContain("ymd(new Date(");
      expect(code).not.toMatch(/toLocale(Date|Time)?String\(/);
      expect(code).not.toMatch(/useLocalToday\(|useMounted\(/);
    });
    it(`${f}: every isStudySessionBlock call passes a zone; every DueLabel renders in one`, () => {
      const code = stripComments(read(f));
      for (const m of code.matchAll(/isStudySessionBlock\(([^)]*)\)/g)) expect(m[1].split(",").length, m[0]).toBe(3);
      for (const m of code.matchAll(/<DueLabel\b[^>]*>/g)) expect(m[0]).toMatch(/timeZone=\{/);
    });
  }
  it("pages hand down the student's today and THE Focus list, never the server's day", () => {
    for (const f of ["app/(app)/dashboard/page.tsx", "app/(app)/plan/page.tsx"]) {
      const src = read(f);
      expect(src).toMatch(/todayYmd=\{dataToday\(data\)\}/);
      expect(src).toMatch(/focusOrder=\{focusSlice\(data\.ranked, Infinity\)/);
    }
  });
  it("no second date formatter in the calendar parts: day names come from lib/dueLabel", () => {
    const parts = stripComments(read("components/calendar/parts.tsx"));
    expect(parts).not.toMatch(/WEEKDAYS_FULL|MONTHS_SHORT|MONTHS_LONG|\.getDay\(\)/);
    expect(parts).toMatch(/from "@\/lib\/dueLabel"/);
  });
});

describe("TimelineView — one effort figure per item, same numbers as the list", () => {
  const src = stripComments(read("components/TimelineView.tsx"));
  it("a Gantt bar prints the item's effort once, never a per-block total beside it", () => {
    const i = src.indexOf('"tl-priority"');
    const bar = src.slice(i, src.indexOf("</button>", i));
    expect(bar).not.toContain("fmtHours(");
    expect(bar.match(/\{effort && /g)?.length).toBe(1);
    expect(src).not.toContain("round1(");
  });
  it("the phone list labels each row's hours as THAT DAY's time and shows the item's effort via EffortTag", () => {
    const agenda = src.slice(src.indexOf("function TimelineAgenda("), src.indexOf("function WeekGantt("));
    expect(agenda).toMatch(/fmtHours\(b\.hours\)\} \$\{dayWord\}/);
    expect(agenda).toMatch(/"today"/);
    expect(agenda).toMatch(/<EffortTag hours=\{effortOf\(/);
  });
  it("order numbers are the Plan list's global ranks; a marker is the item, due that day", () => {
    expect(src).toMatch(/planRanks\(data\.items, data\.ranked\)/);
    expect(src).not.toContain("data.recommendations");
    expect(src).toMatch(/marker \? "Due"/);
  });
});

describe("#135 Plan list wiring (intent)", () => {
  const code = stripComments(read("components/PlanSurface.tsx"));
  const row = code.slice(code.indexOf("function PlanRow("));
  it("what renders is the pure planListView, in the order frozen during Undo", () => {
    expect(code).toMatch(/planListView\(/);
    expect(code).toMatch(/orderDuringUndo\(/);
    expect(code).not.toMatch(/groupPlanItems\(|sortByRank\(/); // no second grouping/sort in the component
  });
  it("check-off: DoneCheck beside a stretched Link (never inside), deferred refresh, Undo toast", () => {
    let depth = 0;
    let checks = 0;
    for (const m of code.matchAll(/<Link\b|<\/Link>|<DoneCheck\b/g)) {
      if (m[0] === "<Link") depth++;
      else if (m[0] === "</Link>") depth--;
      else {
        checks++;
        expect(depth).toBe(0);
      }
    }
    expect(checks).toBe(1);
    expect(row).toMatch(/<DoneCheck[\s\S]*?deferRefresh/);
    expect(row).toMatch(/<DoneCheck[\s\S]*?itemName=\{item\.name\}/);
    expect(code).toContain("<UndoToast");
  });
  it("the row's reason goes through reasonDetail (date stated once)", () => {
    expect(row).toMatch(/reasonDetail\(item\.reason\)/);
    expect(row).not.toMatch(/\{item\.reason\}/);
  });
  it("group headings read 'Past due, 3 items' to screen readers", () => {
    expect(code).toMatch(/className="sr-only">, \{n === 1 \? "1 item" : `\$\{n\} items`\}/);
  });
  it("the violet row's check uses the accent's own foreground", () => {
    expect(row).toMatch(/tone=\{focus \? "onAccent"/);
    expect(read("components/calendar/parts.tsx")).toMatch(/tone === "onAccent"[\s\S]{0,40}border-accent-on/);
  });
});

describe("wording canon (owner): 'Past due' never 'overdue', 'course' never 'class'", () => {
  for (const f of MINE) {
    it(`${f}: user-facing copy`, () => {
      for (const t of userFacing(read(f))) {
        expect(t, t).not.toMatch(/\boverdue\b/i);
        expect(t, t).not.toMatch(/\bclass(es)?\b/i);
      }
    });
  }
  it("one tone for 'Past due': the calm warning chip, never red", () => {
    expect(read("components/calendar/parts.tsx")).toMatch(/export const PAST_DUE_CHIP = `[^`]*toneSoft\.warning/);
    for (const f of MINE) {
      const code = stripComments(read(f));
      for (const m of code.matchAll(/Past due/g)) expect(code.slice(Math.max(0, m.index! - 200), m.index!), f).not.toMatch(/danger[^\n]*$/);
    }
  });
  it("the study-lead helper makes no promise the scheduler doesn't keep", () => {
    expect(read("components/calendar/parts.tsx")).not.toMatch(/kept the day before|~20 min/);
  });
  it("item details show the type label and the short course name, never raw values", () => {
    const parts = stripComments(read("components/calendar/parts.tsx"));
    expect(parts).not.toMatch(/v=\{item\.type\}/);
    expect(parts).not.toMatch(/>\{item\.courseName\}</);
  });
  it("'Mark as done' controls name their item", () => {
    const parts = read("components/calendar/parts.tsx");
    expect(parts).toMatch(/`Mark \$\{itemName\} as done`/);
    for (const f of ["components/DashboardView.tsx", "components/PlanSurface.tsx"]) {
      for (const m of stripComments(read(f)).matchAll(/<DoneCheck\b[^>]*>/g)) expect(m[0], f).toMatch(/itemName=\{/);
    }
  });
  it("the Dashboard says 'all caught up' only when there's nothing left", () => {
    const dash = stripComments(read("components/DashboardView.tsx"));
    expect(dash).toMatch(/caughtUp \? "You’re all caught up\." : "Nothing to focus on right now\."/);
    expect(dash).toMatch(/past due below/);
  });
});
