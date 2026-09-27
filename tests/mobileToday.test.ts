// Ticket #39 (M2): the Dashboard and Plan on phones. The one pure rule —
// which Plan view renders — is unit-tested; the rest are source guards so the
// phone behaviour (no width-dependent render on the dashboard, agenda-only Plan
// that never mounts Calendar/Timeline on a phone, catch-up line, nothing
// hover-only, 44px targets) can't be quietly undone. Class checks compare TOKEN
// SETS of one element's className, so reordering classes or attributes never
// breaks them.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolvePlanView, isPlanView, DEFAULT_PLAN_VIEW } from "@/lib/planView";

const read = (p: string) => readFileSync(p, "utf8");
const PARTS = read("components/calendar/parts.tsx");
const TAP_PHONE = PARTS.match(/export const TAP_PHONE = "([^"]+)";/)?.[1] ?? "";

/** Every class token an element's className can carry: static text, the
 *  `${TAP_PHONE}` constant expanded, and every string literal inside `${…}`. */
function tokensOf(attr: string): Set<string> {
  const expanded = attr.replace(/\$\{TAP_PHONE\}/g, ` ${TAP_PHONE} `);
  const literals = [...expanded.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  const statics = expanded.replace(/\$\{[^}]*\}/g, " ");
  return new Set([...statics.split(/\s+/), ...literals.flatMap((l) => l.split(/\s+/))].filter(Boolean));
}
/** The className of the first element at/after `anchor` in `src`. */
function classAfter(src: string, anchor: string): Set<string> {
  const i = src.indexOf(anchor);
  expect(i, `anchor not found: ${anchor}`).toBeGreaterThanOrEqual(0);
  const m = src.slice(i).match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
  expect(m, `no className after: ${anchor}`).toBeTruthy();
  return tokensOf(m![1] ?? m![2]);
}
/** Every className value in a file, split into separately-applied class strings
 *  (a template's static part and each literal in it), each as a token set. */
function classGroups(src: string): Set<string>[] {
  const out: Set<string>[] = [];
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const v = m[1] ?? m[2];
    const literals = [...v.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    const statics = v.replace(/\$\{[^}]*\}/g, " ");
    for (const piece of [statics, ...literals]) out.push(new Set(piece.split(/\s+/).filter(Boolean)));
  }
  return out;
}
const expectTokens = (set: Set<string>, want: string[]) => {
  for (const t of want) expect(set, `missing class "${t}" in {${[...set].join(" ")}}`).toContain(t);
};
/** A 44px target on phones only: `max-md:tap` (the TAP_PHONE spelling), or the
 *  older `tap` + `md:min-h-0 md:min-w-0` release. */
const expectPhoneTap = (set: Set<string>) => {
  const ok = set.has("max-md:tap") || (set.has("tap") && set.has("md:min-h-0") && set.has("md:min-w-0"));
  expect(ok, `not a phone tap target: {${[...set].join(" ")}}`).toBe(true);
};
const between = (src: string, a: string, b: string) => {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i + 1);
  expect(i).toBeGreaterThanOrEqual(0);
  expect(j).toBeGreaterThan(i);
  return src.slice(i, j);
};

describe("resolvePlanView — phones get the List; nothing until the width is known", () => {
  it("unknown width (server render / first frame) → null, whatever was saved", () => {
    for (const saved of ["list", "calendar", "timeline", null, undefined]) expect(resolvePlanView(saved, null)).toBeNull();
  });
  it("a phone always gets the List, whatever was saved", () => {
    for (const saved of ["list", "calendar", "timeline", null, undefined, "garbage"]) expect(resolvePlanView(saved, true)).toBe("list");
  });
  it("tablet/desktop apply a valid saved view as-is", () => {
    expect(resolvePlanView("list", false)).toBe("list");
    expect(resolvePlanView("calendar", false)).toBe("calendar");
    expect(resolvePlanView("timeline", false)).toBe("timeline");
  });
  it("no or unrecognised preference falls back to the Calendar default on tablet/desktop", () => {
    expect(DEFAULT_PLAN_VIEW).toBe("calendar");
    expect(resolvePlanView(null, false)).toBe("calendar");
    expect(resolvePlanView("month", false)).toBe("calendar");
  });
  it("isPlanView only accepts the three views", () => {
    expect(isPlanView("list")).toBe(true);
    expect(isPlanView("Calendar")).toBe(false);
    expect(isPlanView(3)).toBe(false);
  });
});

describe("PlanSurface on phones", () => {
  const src = read("components/PlanSurface.tsx");

  it("renders through resolvePlanView with a tri-state width (null until known)", () => {
    expect(src).toContain("useState<boolean | null>(null)");
    expect(src).toContain("resolvePlanView(view, phone)");
    expect(src).not.toContain("useIsPhone(");
  });

  it("a skeleton stands in until the width is known; Calendar/Timeline mount only on a resolved view", () => {
    expectTokens(classAfter(src, "{shown === null &&"), ["card", "animate-pulse"]);
    expect(src).toMatch(/\{shown === "calendar" && <CalendarView /);
    expect(src).toMatch(/\{shown === "timeline" && <TimelineView /);
    expect(src).not.toMatch(/\{view === "(list|calendar|timeline)" &&/);
  });

  it("the view switcher (Calendar/Timeline tabs) is hidden below md", () => {
    const tabs = classAfter(src, 'data-tour="plan-views"');
    expectTokens(tabs, ["hidden", "md:flex"]);
    expect(tabs).not.toContain("flex");
  });

  it("the saved preference is only written when the student picks a tab", () => {
    expect(src.match(/localStorage\.setItem\("sp_plan_view"/g)?.length).toBe(1);
    expect(between(src, "function pick(", "return (")).toContain('localStorage.setItem("sp_plan_view", v)');
  });

  it("study sessions come from the pinned StudyWeekStrip, not a second phone-only list", () => {
    expect(src).toContain("<StudyWeekStrip");
    expect(src).not.toContain("<StudyByDay");
  });
});

describe("Dashboard — both variants in the DOM, CSS picks; DOM order = phone order", () => {
  const dash = read("components/DashboardView.tsx");
  const render = between(dash, "  return (\n    <div className=\"mx-auto max-w-7xl\">", "\n// ── AI summary");

  it("nothing rendered depends on the width (useIsPhone only drives the undo clock)", () => {
    expect(dash.match(/useIsPhone\(\)/g)?.length).toBe(1);
    expect(between(dash, "function UndoSlot(", "function ItemRow(")).toContain("useIsPhone()");
    expect(dash).not.toMatch(/\{!?phone &&|phone \?/);
    for (const g of classGroups(dash)) for (const t of g) expect(t, "no order-* reordering").not.toMatch(/^(\w+:)?order-/);
  });

  it("phone-only and desktop-only pieces are chosen by CSS", () => {
    expectTokens(classAfter(render, "<PhoneGlance"), ["md:hidden"]);
    expectTokens(classAfter(render, "<TodayStudyCard"), ["md:hidden"]);
    expectTokens(classAfter(render, "<ThisWeekCard"), ["md:hidden"]);
    expectTokens(classAfter(render, "<CatchUpEntry"), ["md:hidden"]);
    expectTokens(classAfter(render, "{overdueItems.length > 0 && ("), ["hidden", "md:block"]);
    expectTokens(classAfter(render, 'data-tour="dash-progress"'), ["hidden", "md:block"]);
    expectTokens(classAfter(render.slice(render.indexOf("<aside")), "<TodayStudyCard"), ["hidden", "md:block"]);
    expectTokens(classAfter(render, "KPI bar"), ["hidden", "md:flex"]);
  });

  it("the AI summary is desktop-only: one copy, inside a hidden md:block wrapper", () => {
    expect(render.match(/<AiSummary\b/g)?.length).toBe(1);
    expectTokens(classAfter(render, "{!data.connected ?"), ["hidden", "md:block"]);
    expect(render.indexOf("<AiSummary")).toBeGreaterThan(render.indexOf('<div className="hidden md:block">'));
    expect(dash).not.toContain("collapsible");
  });

  it("the Focus card holds its list at every width (one card, one list, as on desktop)", () => {
    const focus = between(dash, "function FocusTodayCard(", "// ── Upcoming assessments");
    expect(focus.match(/<ItemRow\b/g)?.length).toBe(1);
    expect(focus).toContain('side="any"');
    expect(focus).not.toMatch(/Phone variant|Desktop variant/);
    // the Focus pick + its list are ONE rule the phone "This week" card also reads
    expect(dash).toContain("pickFocus(data, liveItems, isDueToday, heldInFocus)"); // held only promotes rows the card already showed
    expect(dash).toContain("!inFocusCard.has(it.canvasId)");
  });

  it("the week chip lives in the phone header row, not in the This week card", () => {
    const glance = between(dash, "function PhoneGlance(", "// A reason-chip");
    expect(glance).toContain("INTENSITY_CFG[intensity]");
    expect(glance).toContain("<ProgressRing");
    const week = between(dash, "function ThisWeekCard(", "// ── Today's study");
    expect(week).not.toContain("INTENSITY_CFG");
    expect(week).not.toContain("intensity");
  });

  // #137 owner's decision: a THIN single line (44px, warning tone, "N overdue ·
  // Catch up", chevron) that expands the overdue rows in place — not a big card row.
  it("catch-up on phones is one thin warning-tone line that expands in place", () => {
    const entry = between(dash, "function CatchUpEntry(", "// ── Phone only: \"This week\"");
    const btn = classAfter(entry, "<button");
    expectTokens(btn, ["tap", "flex", "w-full"]);
    expect(entry).toContain("${toneSoft.warning}");
    expect(entry).toContain("aria-expanded={open}");
    expect(entry).toContain("overdue</span> · Catch up");
    expect(entry).toContain("CHEV_DOWN"); // a disclosure chevron, not "navigate away"
    expect(entry).not.toContain("text-[28px]");
    expect(entry).not.toContain("<Sheet");
    expect(entry).toMatch(/<CatchUpList [^>]*side="phone"/);
    expect(dash).not.toContain("CatchUpPill");
  });

  it("DOM order is the phone's visual order", () => {
    const order = ["<PhoneGlance", "<FocusTodayCard", "<TodayStudyCard", "<CatchUpEntry", "<ThisWeekCard", "<CatchUpCard", "<ProgressDial", "<UpcomingTestsCard"];
    const idx = order.map((s) => render.indexOf(s));
    for (const i of idx) expect(i).toBeGreaterThanOrEqual(0);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("desktop's \"See all\" opens a Sheet of the shared overdue rows", () => {
    expect(dash).toMatch(/import \{ Sheet, useIsPhone \} from "@\/components\/Sheet"/);
    expect(render).toContain("<Sheet open={showCatchUp}");
    expect(render).toMatch(/<Sheet open=\{showCatchUp\}[^>]*>\s*<CatchUpList /);
  });

  it("only the visible copy of a row runs the undo clock", () => {
    expect(between(dash, "function UndoSlot(", "function ItemRow(")).toContain("clock={clock}");
    expect(read("components/UndoToast.tsx")).toMatch(/if \(paused \|\| !clock\) return;/);
  });

  it("list rows are 44px targets (the row wrapper; its link is stretched over it)", () => {
    for (const [a, b] of [["function ItemRow(", "function pickFocus"], ["function CatchUpRow(", "function CatchUpEntry"]]) {
      const row = between(dash, a, b);
      expectTokens(classAfter(row, "<div className"), ["tap", "flex", "relative"]);
      expect(row).toContain("${ROW_LINK}");
    }
  });
});

describe("nothing hover-only on touch", () => {
  for (const file of ["components/DashboardView.tsx", "components/calendar/parts.tsx", "components/PlanSurface.tsx", "components/TimelineView.tsx", "components/CalendarView.tsx", "components/UndoToast.tsx"]) {
    it(`${file}: every class string with opacity-0 + hover:opacity-100 also has hover-reveal`, () => {
      for (const g of classGroups(read(file))) {
        if (g.has("opacity-0") && (g.has("hover:opacity-100") || g.has("group-hover:opacity-100"))) expect(g).toContain("hover-reveal");
      }
    });
  }
  it("the DoneCheck tick is such a control, and it is covered", () => {
    const hits = classGroups(between(PARTS, "export function DoneCheck", "export function MarkDoneButton")).filter((g) => g.has("opacity-0"));
    expect(hits.length).toBeGreaterThan(0);
    for (const g of hits) expectTokens(g, ["hover:opacity-100", "hover-reveal"]);
  });
});

describe("DoneCheck — 22px circle, 44px hit area on phones that stops short of the row text", () => {
  const dc = between(PARTS, "export function DoneCheck", "export function MarkDoneButton");
  it("the button is a phone tap target whose padding is cancelled by equal negative margins", () => {
    expectPhoneTap(new Set(TAP_PHONE.split(" ")));
    const btn = classAfter(dc, "<button");
    expectPhoneTap(btn);
    expectTokens(btn, ["py-[11px]", "-my-[11px]", "pl-4", "-ml-4", "pr-1.5", "-mr-1.5", "md:m-0", "md:p-0"]);
    // right-hand reach (6px) is less than the tightest row gap (gap-2 = 8px)
    expect(btn).not.toContain("-m-[11px]");
    expectTokens(classAfter(dc, "<span className={`grid"), ["h-[22px]", "w-[22px]"]);
  });
  it("a tap on the circle still never navigates the row it sits in", () => {
    expect(dc).toContain("e.preventDefault();");
    expect(dc).toContain("e.stopPropagation();");
  });
});

describe("parts.tsx popovers become Sheets on phones", () => {
  it("ItemDetail, DayPeek, EffortEditor and LoadHint each branch to <Sheet on phones", () => {
    for (const [a, b] of [
      ["export function ItemDetail", "function DetailRow"],
      ["export function DayPeek", "export function AttentionBanner"],
      ["export function EffortEditor", "export interface StudyEntry"],
      ["export function LoadHint", "export function DoneCheck"],
    ]) {
      const body = between(PARTS, a, b);
      expect(body, a).toContain("useIsPhone()");
      expect(body, a).toContain("<Sheet");
    }
  });
  it("the toolbar's view tabs are phone tap targets", () => {
    expectPhoneTap(classAfter(between(PARTS, "export function PeriodToolbar", "export function LoadHint"), 'role="tab"'));
  });
  it("PeriodSummary defers its briefing fetch a tick, guarded by `cancelled`", () => {
    const ps = between(PARTS, "export function PeriodSummary", "export function PeriodToolbar");
    expect(ps).toMatch(/setTimeout\(\(\) => \{\s*if \(cancelled\) return;\s*fetch\(`\/api\/calendar\/briefing/);
    expect(ps).toContain("clearTimeout(timer)");
  });
});

describe("TimelineView — agenda below md, Gantt at md+", () => {
  const src = read("components/TimelineView.tsx");
  it("renders the day-grouped agenda on phones and hides the Gantt there", () => {
    expect(src).toContain("function TimelineAgenda(");
    expectTokens(classAfter(src, "Phones (#39): no Gantt"), ["md:hidden"]);
    expectTokens(classAfter(src.slice(src.indexOf("<TimelineAgenda courses")), "<div"), ["hidden", "md:block"]);
  });
  it("day headings are h2 and the #1 row carries the demo-tour anchor", () => {
    const agenda = between(src, "function TimelineAgenda(", "const BAR_H");
    expect(agenda).toContain("<h2 ");
    expect(agenda).not.toContain("<h3");
    expect(agenda).toContain('"tl-agenda"');
  });
});

describe("CalendarView", () => {
  const src = read("components/CalendarView.tsx");
  it("Month scrolls sideways inside a box below md (560px floor); Week still stacks below sm", () => {
    const month = between(src, "function MonthView(", "function MonthLegend");
    expectTokens(classAfter(month, "<div className=\"overflow"), ["overflow-x-auto", "md:overflow-visible"]);
    expectTokens(classAfter(month, '<div className="min-w'), ["min-w-[560px]", "md:min-w-0"]);
    expectTokens(classAfter(between(src, "function WeekView(", "function MonthView("), "<div className=\"grid"), ["grid-cols-1", "sm:grid-cols-7"]);
  });
  it("on phones, picking an item in the day peek swaps sheets instead of stacking them", () => {
    expect(between(src, "<DayPeek", "{selected &&")).toMatch(/if \(phone\) setPeek\(null\);\s*setSelected\(it\);/);
  });
});

describe("UndoToast — full-size Undo on phones", () => {
  const src = read("components/UndoToast.tsx");
  it("the Undo button is a phone tap target with px-3, compact again at md+", () => {
    const btn = classAfter(src, "type=\"button\"");
    expectPhoneTap(btn);
    expectTokens(btn, ["px-3", "md:px-1.5"]);
  });
  it("the bar is at least 44px below md", () => {
    expectTokens(classAfter(src, "onBlur="), ["min-h-11", "md:min-h-0"]);
  });
});
