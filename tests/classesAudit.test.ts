// Ticket #141 — UI audit round 1, Classes + wayfinding. One guard (or real unit
// test) per finding so the fixes can't quietly regress:
//   1 dates in the viewer's zone (DueLabel)   5 CalendarView a11y + URL place
//   2 truncation that destroyed identity      6 rolling 7-day Week view
//   3 "Classes" everywhere                    7 dark-mode contrast on the violet row
//   4 wayfinding (back link, card, tabs)      8 copy
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { rangeForView, rangeLabel, ymd, addDays } from "@/lib/calendarDates";
import { navItems, pageTitle } from "@/components/navItems";
import { calendarPlaceFromSearch, writeCalendarPlace } from "@/components/CalendarView";
import { DEMO_VIEW_LABEL } from "@/lib/tour/demoTour";

const read = (p: string) => readFileSync(p, "utf8");
/** Source without comments, so prose about a banned pattern doesn't trip a guard. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/ .*$/gm, "");
/** The opening tag (up to the first unquoted `>` at depth 0) that contains `marker`. */
function openingTag(src: string, marker: string): string {
  const idx = src.indexOf(marker);
  if (idx < 0) throw new Error(`marker not found: ${marker}`);
  let start = idx;
  while (start > 0 && !(src[start] === "<" && /[A-Za-z]/.test(src[start + 1] ?? ""))) start--;
  let depth = 0;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}
const tokens = (tag: string) => new Set((tag.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/)?.slice(1).find(Boolean) ?? "").split(/\s+/));

const GRID = "components/CourseGrid.tsx";
const PAGE = "components/CoursePage.tsx";
const PLAN = "components/PlanSurface.tsx";
const CAL = "components/CalendarView.tsx";
const EXCL = "components/CourseExclude.tsx";
const COURSES = "app/(app)/courses/page.tsx";
const CLASS = "app/(app)/class/[courseId]/page.tsx";
const DEMO = "components/DemoExperience.tsx";
const TOUR = "lib/tour/demoTour.ts";

describe("1 · due dates go through DueLabel (viewer's zone), never a local formatter", () => {
  for (const [file, formats] of [
    [GRID, ["countdown"]],
    [PAGE, ["short", "long-plain"]],
    [PLAN, ["countdown"]],
    [CAL, ["chip"]],
  ] as const) {
    it(`${file} renders <DueLabel> with ${formats.join(" + ")}`, () => {
      const src = code(file);
      expect(src).toMatch(/import \{ DueLabel \} from "@\/components\/DueLabel"/);
      for (const f of formats) expect(src).toMatch(new RegExp(`<DueLabel [^>]*format="${f}"`));
      expect(src).not.toMatch(/\bdueLabel\(/);
      expect(src).not.toMatch(/\bcountdownLabel\(/);
    });
  }
  it("CoursePage's private dueLabel() is gone", () => {
    expect(read(PAGE)).not.toMatch(/function dueLabel\(/);
  });
  it("CalendarView prints no due weekday from the runtime's zone", () => {
    expect(code(CAL)).not.toMatch(/toLocaleDateString\(undefined, \{ weekday/);
  });
});

describe("2 · titles keep their identity", () => {
  it("class-card titles clamp to two lines (not truncate), always two lines tall, inside a min-w-0 column", () => {
    const src = read(GRID);
    const title = tokens(openingTag(src, "<h2"));
    expect(title.has("line-clamp-2")).toBe(true);
    expect(title.has("min-h-[2lh]")).toBe(true); // "Do next" rows align across cards
    expect(title.has("truncate")).toBe(false);
    expect(src).toMatch(/className="min-w-0[^"]*">[\s\S]{0,200}?<h2/);
  });
  it("class-page rows: the title clamps to two lines, and phones get the short date", () => {
    const src = read(PAGE);
    const row = src.slice(src.indexOf("function Row("));
    expect(row).toMatch(/<span className=\{`line-clamp-2 [^`]*`\}>\{item\.name\}/);
    expect(openingTag(row, 'format="short"')).toContain('className="md:hidden"');
    expect(openingTag(row, 'format="long-plain"')).toContain('className="max-md:hidden"');
  });
  it("course names are always cleaned (no raw '2026F-01:' codes)", () => {
    expect(code(GRID)).toContain("{cleanCourse(courseName)}");
    expect(code(PAGE)).toContain("{cleanCourse(courseName)}");
    expect(code(EXCL)).toContain("{cleanCourse(c.name)}");
    expect(code(CAL)).toContain("shortCourse(item.courseName)");
  });
  it("Excluded list: the heading once, then bare names with their Include buttons", () => {
    const src = code(EXCL);
    expect(src).not.toContain("Excluded from your plan:");
    const row = src.slice(src.indexOf("export function ExcludedCoursesRow"), src.indexOf("export function ExcludedBanner"));
    expect(row.match(/Excluded from your plan/g)).toHaveLength(1);
    expect(row.indexOf("Excluded from your plan")).toBeLessThan(row.indexOf("courses.map("));
    expect(row).toContain("Include again");
  });
  it("Week chips show overdue with the alert glyph, not colour alone", () => {
    const src = read(CAL);
    const chip = src.slice(src.indexOf("function WeekChip("), src.indexOf("function MonthView("));
    expect(chip).toMatch(/\{overdue && \(\s*<span [^>]*aria-hidden>\s*<Glyph d=\{ICON\.alert\}/);
    expect(chip).toContain('", past due"');
  });
  it("Week chips clamp to two lines instead of 'TO…'", () => {
    const src = read(CAL);
    const chip = src.slice(src.indexOf("function WeekChip("), src.indexOf("function MonthView("));
    expect(chip).toMatch(/line-clamp-2[^`]*`\}>\{item\.name\}/);
    expect(src.slice(src.indexOf("function WeekView("), src.indexOf("function WeekChip("))).toContain("<WeekChip ");
  });
});

describe("3 · 'Classes' everywhere a student reads it", () => {
  it("nav label, tab label and top-bar title", () => {
    const item = navItems.find((i) => i.href === "/courses")!;
    expect(item.label).toBe("Classes");
    expect(item.tabLabel).toBe("Classes");
    expect(pageTitle("/courses")).toBe("Classes");
  });
  it("the Classes page heading — real app and demo", () => {
    expect(read(COURSES)).toMatch(/<h1[^>]*>Classes<\/h1>/);
    expect(read(DEMO)).toMatch(/<h1[^>]*>Classes<\/h1>/);
    expect(DEMO_VIEW_LABEL.courses).toBe("Classes");
  });
  for (const file of [GRID, PAGE, EXCL, CAL, PLAN, COURSES, DEMO, TOUR, "components/CourseCarousel.tsx", "components/navItems.ts"]) {
    it(`${file}: no "course" in user-facing strings`, () => {
      const src = code(file).replace(/^import .*$/gm, "");
      const strings = [...src.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2]);
      const jsxText = [...src.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]);
      const userFacing = [...strings, ...jsxText]
        .map((t) => t.replace(/\$\{[^}]*\}/g, "")) // template holes are code
        .filter((t) => !/^[/@]/.test(t.trim())) // paths, hrefs
        .filter((t) => !/^[a-z0-9-]+$/.test(t.trim())); // kebab ids (data-tour, keys)
      for (const t of userFacing) expect(t, t).not.toMatch(/\bcourses?\b/i);
    });
  }
});

describe("4 · wayfinding", () => {
  it("class page: history-aware back, falling back to Classes (never '← Dashboard')", () => {
    const src = code(PAGE);
    expect(src).not.toContain("← Dashboard");
    expect(src).toContain("window.history.length <= 1");
    expect(src).toContain("document.referrer");
    expect(src).toContain("router.back()");
    expect(openingTag(src, "onClick={goBack}")).toContain('href="/courses"');
    // one stable label — only the behaviour changes after mount
    expect(src).toMatch(/onClick=\{goBack\}[^>]*>\s*← Back\s*<\/Link>/);
    expect(src).not.toContain("← Classes");
  });
  it("the demo's class page gets a working back (the demo blocks real links)", () => {
    const demo = code(DEMO);
    expect(openingTag(demo, "<CoursePage")).toContain("onBack={onBack}");
    expect(demo).toMatch(/<DemoDetail [^>]*onBack=\{\(\) => setDetail\(null\)\}/);
    const page = code(PAGE);
    expect(page).toMatch(/if \(onBack\) \{\s*e\.preventDefault\(\);\s*onBack\(\);/);
  });
  it("class card: a div.relative with a stretched title link; the menu is a sibling, not inside the <Link>", () => {
    const src = code(GRID);
    const card = src.slice(src.indexOf("function CourseCard("));
    expect(tokens(openingTag(card, "data-tour={anchor}")).has("relative")).toBe(true);
    const link = openingTag(card, "<Link");
    for (const t of ["after:absolute", "after:inset-0", "after:content-['']"]) expect(tokens(link).has(t), t).toBe(true);
    const inside = card.slice(card.indexOf("<Link"), card.indexOf("</Link>"));
    expect(inside).not.toContain("<CourseMenu");
    expect(card.indexOf("<CourseMenu")).toBeGreaterThan(card.indexOf("</Link>"));
    expect(card).toMatch(/className="relative z-10[^"]*">\s*\{meta && <GradePill[^\n]*\n\s*\{!demo && <CourseMenu/);
  });
  it("class-page rows: the done circle is a sibling of the row <Link>, raised above its stretched overlay", () => {
    const src = code(PAGE);
    const row = src.slice(src.indexOf("function Row("));
    const link = openingTag(row, "itemHref(");
    for (const t of ["after:absolute", "after:inset-0", "after:content-['']", "min-h-11"]) expect(tokens(link).has(t), t).toBe(true);
    const inside = row.slice(row.indexOf("<Link"), row.indexOf("</Link>"));
    expect(inside).not.toContain("<DoneCheck");
    expect(row.match(/<span className="relative z-10[^"]*">\s*<DoneCheck/g)).toHaveLength(2);
    expect(tokens(openingTag(row, "<div")).has("relative")).toBe(true);
  });
  it("focus rings use the solid accent (the pale accent-ring token fails 3:1)", () => {
    for (const f of [PAGE, GRID, "components/CourseCarousel.tsx"]) expect(code(f), f).not.toContain("ring-accent-ring");
  });
  it("heading outline: page h1 → card h2 (no orphan h3)", () => {
    expect(read(GRID)).not.toContain("<h3");
    expect(read(GRID)).toContain("<h2");
    expect(read(COURSES)).toContain("<h1");
  });
  it("class tabs: arrow/Home/End keys, roving tabIndex, and ?tab= in the URL", () => {
    const src = code(PAGE);
    expect(openingTag(src, 'role="tablist"')).toContain("onKeyDown={onTabKey}");
    for (const k of ['"ArrowRight"', '"ArrowLeft"', '"Home"', '"End"']) expect(src).toContain(k);
    const tab = openingTag(src, 'role="tab"');
    expect(tab).toContain("tabIndex={tab === t.id ? 0 : -1}");
    expect(tab).toContain("aria-selected");
    expect(tab).toContain('aria-controls="class-tabpanel"');
    expect(src).toMatch(/searchParams\.set\("tab", t\)/);
    expect(src).toContain("window.history.replaceState(");
    const route = code(CLASS);
    expect(route).toContain("searchParams");
    expect(route).toContain("initialTab={initialTab}");
  });
});

describe("5 · CalendarView a11y and a refresh-proof place", () => {
  const src = code(CAL);
  it("the empty-day '—' button has an accessible name", () => {
    const dash = src.indexOf("<span aria-hidden>—</span>");
    expect(dash).toBeGreaterThan(0);
    expect(src.slice(src.lastIndexOf("<button", dash), dash)).toMatch(/aria-label=\{`Nothing due \$\{fullDate\(d\)\}/);
  });
  it("weekday heads come from lib/calendarDates, not a local array", () => {
    expect(src).not.toMatch(/\["Mon", "Tue"/);
    expect(src).toContain("[...WEEKDAYS.slice(1), WEEKDAYS[0]]");
    expect(src).toContain("WEEKDAYS_MON_FIRST.map(");
  });
  it("month cells are named with the full date, not just a digit", () => {
    const month = src.slice(src.indexOf("function MonthView("));
    expect(openingTag(month, "onClick={() => onPeek(d)}")).toMatch(/aria-label=\{\[\s*fullDate\(d\)/);
  });
  it("the item and day dialogs get the page's day (not the client's guess)", () => {
    expect(openingTag(src, "<DayPeek")).toContain("todayYmd={todayYmd}");
    expect(openingTag(src, "<ItemDetail")).toContain("todayYmd={todayYmd}");
  });
  it("the Completed toggle reports its state", () => {
    const btn = openingTag(src, "setShowCompleted((s) => !s)");
    expect(btn).toContain("aria-expanded={showCompleted}");
    expect(btn).toContain('aria-controls="calendar-completed"');
  });
  it("view + date are read in the state initializers (first frame is right) and written on move", () => {
    const init = src.slice(src.indexOf("const [urlPlace] = useState("), src.indexOf("const [selected"));
    expect(init).toContain('!demo && typeof window !== "undefined" ? calendarPlaceFromSearch(window.location.search)');
    expect(init).toContain("useState<View>(urlPlace.view ?? defaultView)");
    expect(init).toContain("parseYmd(urlPlace.date ?? todayYmd)");
    expect(src).not.toMatch(/useEffect\(/);
    expect(src).toContain("if (!demo) writeCalendarPlace(nextView, ymd(nextAnchor), todayYmd);");
  });
  it("leaving the Calendar for List/Timeline clears the params", () => {
    expect(code(PLAN)).toMatch(/if \(v !== "calendar" && !demo\) writeCalendarPlace\(null\);/);
  });
  it("calendarPlaceFromSearch parses good values and drops bad ones", () => {
    expect(calendarPlaceFromSearch("?view=week&date=2026-09-27")).toEqual({ view: "week", date: "2026-09-27" });
    expect(calendarPlaceFromSearch("?view=month")).toEqual({ view: "month", date: null });
    expect(calendarPlaceFromSearch("?view=list&date=2026-02-30")).toEqual({ view: null, date: null });
    expect(calendarPlaceFromSearch("?date=tomorrow")).toEqual({ view: null, date: null });
    expect(calendarPlaceFromSearch("")).toEqual({ view: null, date: null });
  });
});

describe("writeCalendarPlace", () => {
  afterEach(() => vi.unstubAllGlobals());
  const run = (href: string, ...args: Parameters<typeof writeCalendarPlace>) => {
    const replaceState = vi.fn();
    vi.stubGlobal("window", { location: { href }, history: { replaceState } });
    writeCalendarPlace(...args);
    return replaceState.mock.calls[0]?.[2];
  };
  it("sets view + date, and drops date when it's today", () => {
    expect(run("https://x.test/plan", "week", "2026-09-30", "2026-09-27")).toBe("/plan?view=week&date=2026-09-30");
    expect(run("https://x.test/plan?date=2026-09-30", "week", "2026-09-27", "2026-09-27")).toBe("/plan?view=week");
  });
  it("null clears both and keeps anything else", () => {
    expect(run("https://x.test/plan?view=month&date=2026-10-01&x=1", null)).toBe("/plan?x=1");
  });
});

describe("6 · Week = a rolling 7 days starting on the anchor day", () => {
  it("every weekday anchor starts its own week, including a Sunday evening", () => {
    for (let i = 0; i < 7; i++) {
      const anchor = new Date(2026, 8, 21 + i, 21, 30); // Mon Sep 21 … Sun Sep 27, 9:30 PM
      const { start, days } = rangeForView("week", anchor);
      expect(days).toBe(7);
      expect(ymd(start)).toBe(ymd(anchor));
      expect(start.getHours()).toBe(0);
      expect(ymd(addDays(start, days - 1))).toBe(ymd(addDays(anchor, 6)));
    }
  });
  it("Sunday Sep 27 shows Sep 27 – Oct 3 (no past days)", () => {
    const sun = new Date(2026, 8, 27, 20);
    expect(rangeLabel("week", sun, sun)).toBe("Sep 27 – Oct 3");
  });
  it("day and month are unchanged", () => {
    const a = new Date(2026, 8, 27, 20);
    expect(ymd(rangeForView("day", a).start)).toBe("2026-09-27");
    expect(rangeForView("day", a).days).toBe(1);
    expect(ymd(rangeForView("month", a).start)).toBe("2026-09-01");
    expect(rangeForView("month", a).days).toBe(30);
  });
  it("the Week grid, Today button and ‹ › all use the rolling window", () => {
    const src = code(CAL);
    expect(src.slice(src.indexOf("function WeekView("))).toContain('rangeForView("week", anchor)');
    expect(src).toContain("goTo(view, addDays(anchor, dir * 7))");
    expect(src).toContain("onToday={() => goTo(view, now)}");
    expect(src).not.toContain("weekStart(");
  });
});

describe("7 · the violet surfaces use the accent's foreground token at full strength", () => {
  it("no literal white on the Plan's accent row", () => {
    const src = code(PLAN);
    for (const t of ["text-white", "bg-white", "ring-white"]) expect(src, t).not.toContain(t);
  });
  it("Plan, Dashboard and Study share one chip and never fade the foreground (≥4.5:1 in light mode)", () => {
    const CHIP = "bg-accent-hover px-2.5 py-1 text-xs font-medium text-accent-on ring-1 ring-inset ring-accent-on/25";
    for (const f of [PLAN, "components/DashboardView.tsx", "components/studyUi.tsx"]) {
      const src = code(f);
      expect(src, f).not.toContain("text-accent-on/80");
      expect(src, f).not.toContain("bg-accent-on/15");
    }
    expect(code("components/DashboardView.tsx")).toContain(CHIP);
    expect(code("components/studyUi.tsx")).toContain(CHIP);
    expect(code(PLAN)).toContain('const FOCUS_CHIP = "bg-accent-hover text-accent-on ring-1 ring-inset ring-accent-on/25"');
  });
});

describe("8 · copy", () => {
  it("sentence case, and the tablist is named for a class", () => {
    expect(code(CAL)).not.toContain(">TODAY<");
    expect(code(PAGE)).toContain('aria-label="Class view"');
    expect(code(PAGE)).not.toContain("capitalize");
  });
});
