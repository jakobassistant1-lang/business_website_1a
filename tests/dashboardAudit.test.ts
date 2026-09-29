// Ticket #137 — UI audit round 1, Dashboard. Behaviour tests for the day rule
// (the bug: an SSR render reads due days in UTC, the viewer in their own zone),
// plus intent-level source guards for each finding: due dates through
// <DueLabel>, no button nested in a link, the shared Sheet, the focus stated
// once, the phone catch-up line, accent-on text on violet, page semantics/copy.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { isDueOn, pickFocus } from "@/components/DashboardView";
import type { CalendarItem } from "@/lib/calendarData";
import type { ScoredAssignment } from "@/lib/priority";
import { focusSlice } from "@/lib/rankActive";

// Tue Sep 29 2026, 11:30 PM America/New_York == Wed Sep 30 03:30 UTC.
const LATE = "2026-09-30T03:30:00.000Z";
const LATER = "2026-10-02T16:00:00.000Z"; // Fri, same day in both zones
const NY = "America/New_York";

describe("the dashboard's day rule — the student's Canvas zone, never the runtime's", () => {
  it("isDueOn reads the due instant's day in the given zone", () => {
    expect(isDueOn({ dueAt: LATE }, "2026-09-29", NY)).toBe(true); // 11:30 PM tonight in New York
    expect(isDueOn({ dueAt: LATE }, "2026-09-29", "UTC")).toBe(false); // already tomorrow in UTC
    expect(isDueOn({ dueAt: null }, "2026-09-29", NY)).toBe(false);
  });
  it("pickFocus: a heavy today lists every due-today row; otherwise the next three by rank", () => {
    const item = (canvasId: number, dueAt: string) => ({ canvasId, dueAt, status: "normal", name: `#${canvasId}` }) as unknown as CalendarItem;
    // #1 is the focus; #2 is ranked high but due Friday; #3-#6 are due 23:30 NY tonight.
    const items = [item(1, LATER), item(2, LATER), item(3, LATE), item(4, LATE), item(5, LATE), item(6, LATE)];
    const order = items.map((it) => it.canvasId);
    const today = "2026-09-29";
    const ids = (zone: string) => pickFocus(order, items, (it) => isDueOn(it, today, zone), () => false).rest.map((it) => it.canvasId);
    expect(pickFocus(order, items, () => false, () => false).focusItem?.canvasId).toBe(1);
    expect(ids("UTC")).toEqual([2, 3, 4]); // nothing reads as today → the next three by rank
    expect(ids(NY)).toEqual([3, 4, 5, 6]); // four due tonight → all of them, #2 waits
  });
  it("pickFocus (#135) reads THE ranking module's Focus list: past due leads and fills the rows beneath", () => {
    const it = (canvasId: number, status: string, extra: object = {}) => ({ canvasId, dueAt: LATER, status, name: `#${canvasId}`, ...extra }) as unknown as CalendarItem;
    const items = [it(1, "overdue"), it(2, "normal", { locked: true }), it(3, "overdue"), it(4, "normal", { passive: true }), it(5, "normal"), it(6, "normal"), it(7, "normal")];
    // The ranking: locked/passive and a zero-importance item sit at the bottom.
    const ranked = [
      { canvasId: 1, value: 3 }, { canvasId: 3, value: 2 }, { canvasId: 5, value: 1 }, { canvasId: 6, value: 0.5 },
      { canvasId: 7, value: 0 }, { canvasId: 2, value: 0, locked: true }, { canvasId: 4, value: 0, passive: true },
    ] as unknown as ScoredAssignment[];
    const order = focusSlice(ranked, Infinity).map((r) => r.canvasId);
    const { focusItem, rest } = pickFocus(order, items, () => false, () => false);
    expect(focusItem?.canvasId).toBe(1);
    expect(rest.map((r) => r.canvasId)).toEqual([3, 5, 6]); // locked, passive, zero importance never make the card
    // …and data.recommendations (focusSlice's first TOP_N) is the head of the same list.
    expect(focusSlice(ranked).map((r) => r.canvasId)).toEqual([1, 3, 5]);
  });
  it("a row checked off in the card keeps its spot through a refresh that drops it from the ranking", () => {
    const it = (canvasId: number) => ({ canvasId, dueAt: LATER, status: "normal", name: `#${canvasId}` }) as unknown as CalendarItem;
    const items = [it(1), it(2), it(3), it(4)];
    const { rest } = pickFocus([1, 3, 4], items, () => false, (id) => id === 2); // #2 was checked, then left the order
    expect(rest.map((r) => r.canvasId)).toContain(2);
  });
});

// ── Source guards ───────────────────────────────────────────────────────────────
const dash = readFileSync("components/DashboardView.tsx", "utf8");
/** The source without comments, so guards only see code and rendered copy. */
const code = dash
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\s\/\/\s.*$/gm, "");
const between = (src: string, a: string, b: string) => {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i + 1);
  expect(i, `missing: ${a}`).toBeGreaterThanOrEqual(0);
  expect(j, `missing: ${b}`).toBeGreaterThan(i);
  return src.slice(i, j);
};

describe("1 · due dates: <DueLabel> for words, the student's zone for logic", () => {
  it("no hand-formatted due dates; every DueLabel renders in the student's zone", () => {
    const labels = [...code.matchAll(/<DueLabel\b[^>]*>/g)].map((m) => m[0]);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    for (const l of labels) expect(l).toContain("timeZone={zone}");
    for (const banned of ["WEEKDAYS", "countdownLabel(", "fmtTime(", "getDay()"]) expect(code, banned).not.toContain(banned);
  });
  it("no runtime-zone day reads and no mount swap: the zone is dataZone(data), today is the loader's", () => {
    expect(code).not.toMatch(/\bymd\(/);
    expect(dash).not.toContain("isUpcomingStudy");
    expect(code).not.toMatch(/useMounted|useLocalToday|dashboardZone|dashboardDay|isTodayStudy/);
    expect(code).toContain("const zone = dataZone(data);");
    expect(code).toContain("const todayYmd = data.todayYmd ?? pageToday;");
    for (const m of code.matchAll(/ymdInZone\(([^)]*)\)/g)) expect(m[1]).toMatch(/, zone$/);
  });
  it("study sessions go through THE rule with the zone (a marker is never \"Study booked\")", () => {
    expect(code).not.toMatch(/\bb\.study\b/);
    expect(code.match(/isStudySessionBlock\(b, todayYmd, zone\)/g)?.length).toBe(2); // Today's study + Study booked
  });
});

describe("2 · no <button> inside a <Link>", () => {
  it("no DoneCheck sits between a <Link and its </Link>", () => {
    let depth = 0;
    let checks = 0;
    for (const m of code.matchAll(/<Link\b|<\/Link>|<DoneCheck\b/g)) {
      if (m[0] === "<Link") depth++;
      else if (m[0] === "</Link>") depth--;
      else {
        checks++;
        expect(depth, `DoneCheck nested in a Link at ${m.index}`).toBe(0);
      }
    }
    expect(checks).toBeGreaterThan(0);
  });
  it("each row with a check: relative wrapper, check above the overlay and first in tab order, stretched link", () => {
    expect(dash).toMatch(/const ROW_LINK = "[^"]*after:absolute[^"]*after:inset-0/);
    for (const [a, b] of [["function ItemRow(", "export function pickFocus"], ["function CatchUpRow(", "function CatchUpEntry"]]) {
      const row = between(code, a, b);
      expect(row).toMatch(/className=\{`[^`]*\brelative\b/);
      expect(row).toMatch(/<DoneCheck [^>]*className="[^"]*\bz-10\b/);
      expect(row.indexOf("<DoneCheck")).toBeLessThan(row.indexOf("<Link")); // keyboard: check, then link
      expect(row).toContain("${ROW_LINK}");
      expect(row).toMatch(/<EffortTag [^>]*\$\{ABOVE_LINK\}/); // its tooltip stays hoverable
    }
    expect(dash).toMatch(/const ABOVE_LINK = "[^"]*z-10/);
  });
});

describe("3 · the overdue list opens in the shared Sheet", () => {
  it("no hand-made dialog", () => {
    expect(dash).not.toContain("OverdueModal");
    expect(code).not.toContain('role="dialog"');
    expect(code).not.toContain("fixed inset-0");
    expect(code).toMatch(/<Sheet\b/);
  });
  it("ONE past-due list (one subtitle) rendered by all three catch-up surfaces", () => {
    expect(code.match(/<CatchUpList\b/g)?.length).toBe(3);
    expect(code.match(/<CatchUpRow\b/g)?.length).toBe(1);
    expect(code.match(/most important first/gi)?.length).toBe(1);
  });
});

describe("4 · desktop states each thing once", () => {
  it("no rationale line under the Focus chips", () => {
    expect(dash).not.toContain("focusRationale");
    expect(code).not.toMatch(/strong place to start|knock it out/);
  });
  it("no overdue stat block — the Catch-up card is the one count", () => {
    expect(dash).not.toContain("OverdueKpi");
    expect(code).not.toContain("View all");
  });
  it("the desktop progress ring shows only when something is due today; phones keep the small ring", () => {
    expect(code).toMatch(/dialTotal > 0 &&[\s\S]{0,40}data-tour="dash-progress"/);
    expect(between(code, "function PhoneGlance(", "function Chip(")).toContain("<ProgressRing");
  });
});

describe("5 · phone catch-up: a thin line above This week that expands in place", () => {
  const entry = between(code, "function CatchUpEntry(", "function ThisWeekCard(");
  it("sits above This week and is absent at zero", () => {
    expect(code).toMatch(/overdueCount > 0 && <CatchUpEntry /);
    expect(code.indexOf("<CatchUpEntry")).toBeLessThan(code.indexOf("<ThisWeekCard"));
  });
  it("a disclosure: aria-expanded/controls, inert when folded, down chevron, named section", () => {
    expect(entry).toContain("aria-expanded={open}");
    expect(entry).toContain("aria-controls={panelId}");
    expect(entry).toContain("inert={!open}");
    expect(entry).toContain("CHEV_DOWN");
    expect(entry).not.toContain("ICON.chevR");
    expect(entry).toMatch(/<section aria-labelledby=\{headingId\}/);
    expect(entry).toMatch(/<h2 id=\{headingId\} className="sr-only"/);
  });
  it("warning tone, every transition motion-safe, no big count, no sheet", () => {
    expect(entry).toContain("toneSoft.warning");
    const transitions = [...entry.matchAll(/\S*transition\S*/g)].map((m) => m[0]);
    expect(transitions.length).toBeGreaterThan(0);
    for (const t of transitions) expect(t, "transition must be motion-safe").toMatch(/^motion-safe:/);
    expect(entry).not.toContain("text-[28px]");
    expect(entry).not.toContain("<Sheet");
  });
});

describe("6 · text on the violet accent uses the accent-on token", () => {
  it("no white text/fills anywhere in the dashboard", () => {
    for (const t of ["text-white", "bg-white", "ring-white"]) expect(code, t).not.toContain(t);
  });
  it("every bg-accent surface with text sets text-accent-on; chips and the Open button too", () => {
    // solid bg-accent only (tinted dots like bg-accent/60 carry no text)
    const solid = [...code.matchAll(/className="([^"]*\bbg-accent(?=[\s"])[^"]*)"/g)];
    expect(solid.length).toBeGreaterThan(0);
    for (const m of solid) expect(m[1]).toContain("text-accent-on");
    expect(between(code, "function Chip(", "type Side")).toContain("text-accent-on");
    expect(code).toMatch(/className="[^"]*\bbg-accent-on\b[^"]*\btext-accent\b/); // Open: inverted pair
  });
});

describe("7 · page semantics and copy", () => {
  it("the greeting is the page's one h1", () => {
    expect(code.match(/<h1\b/g)?.length).toBe(1);
    expect(between(code, "<h1", "</h1>")).toContain("{greeting}");
  });
  it("the date line is Intl.DateTimeFormat (weekday/month/day) over the student's day", () => {
    expect(dash).toMatch(/Intl\.DateTimeFormat\([^)]*weekday: "long"[^)]*month: "long"[^)]*day: "numeric"/);
    expect(code).toContain("{fmtDayLine(todayYmd)}");
  });
  it("the Focus card's Open button names the item for screen readers", () => {
    expect(code).toMatch(/Open<span className="sr-only">[^<]*\{focusItem\.name\}<\/span>/);
  });
  it("curly apostrophes in copy, and no → tacked onto link text", () => {
    expect(code).not.toContain("&apos;");
    expect(code).not.toMatch(/[A-Za-z]'[a-z]/);
    expect(code).not.toContain("→");
  });
});
