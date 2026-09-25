// Ticket #39 (M4): forms, auth, onboarding demo, billing and admin on phones.
// A pure table for the demo tour's phone placement (sideFor / placementFor),
// plus grep guards so the touch wiring on these surfaces can't be quietly undone.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  sideFor,
  placementFor,
  selectorFor,
  isAnchorShown,
  PHONE_MAX_WIDTH,
  DEMO_STEPS,
  type TourSide,
  type AnchorLike,
} from "@/lib/tour/demoTour";

const read = (p: string) => readFileSync(p, "utf8");

/** Every className in a source file, as token lists (static strings and template literals). */
function classLists(src: string): string[][] {
  const out: string[][] = [];
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    out.push((m[1] ?? m[2]).split(/\s+/).filter(Boolean));
  }
  return out;
}

/** Interactive elements (<button, <a, <Link) with their own className tokens. The
 *  attribute run is read up to the next "<" (attributes hold arrows like `=>`,
 *  never a "<"), so a child's className is never mistaken for the control's. */
function controls(src: string): { tag: string; tokens: string[] }[] {
  const out: { tag: string; tokens: string[] }[] = [];
  for (const m of src.matchAll(/<(button|a|Link)\b([^<]*)/g)) {
    const cls = m[2].match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
    out.push({ tag: m[1], tokens: cls ? (cls[1] ?? cls[2]).split(/\s+/).filter(Boolean) : [] });
  }
  return out;
}

/** Source with phone-only containers (<nav … md:hidden …>…</nav>) cut out. */
const withoutPhoneOnlyNavs = (src: string) => src.replace(/<nav\b[^>]*\bmd:hidden\b[^>]*>[\s\S]*?<\/nav>/g, "");

describe("sideFor (demo tour popover side by viewport)", () => {
  it.each<[TourSide | undefined, number, TourSide | undefined]>([
    // Phone widths: beside-the-anchor → below it.
    ["right", 375, "bottom"],
    ["left", 375, "bottom"],
    ["right", 767, "bottom"],
    ["left", 767, "bottom"],
    // Phone widths: every other side is kept.
    ["bottom", 375, "bottom"],
    ["top", 375, "top"],
    ["over", 375, "over"],
    [undefined, 375, undefined],
    // md and up: unchanged.
    ["right", 768, "right"],
    ["left", 768, "left"],
    ["right", 1440, "right"],
    ["top", 1024, "top"],
    [undefined, 1024, undefined],
  ])("%s at %ipx → %s", (desired, width, expected) => {
    expect(sideFor(desired, width)).toBe(expected);
  });

  it("the phone cutoff is the md breakpoint", () => {
    expect(PHONE_MAX_WIDTH).toBe(768);
  });
});

describe("placementFor (side + align)", () => {
  it("a flipped side is centered under the anchor", () => {
    expect(placementFor({ side: "right", align: "start" }, 375)).toEqual({ side: "bottom", align: "center" });
    expect(placementFor({ side: "left", align: "end" }, 390)).toEqual({ side: "bottom", align: "center" });
  });
  it("an unflipped side keeps the step's own align", () => {
    expect(placementFor({ side: "bottom", align: "end" }, 375)).toEqual({ side: "bottom", align: "end" });
    expect(placementFor({ side: "right", align: "start" }, 1280)).toEqual({ side: "right", align: "start" });
    expect(placementFor({}, 375)).toEqual({ side: undefined, align: undefined });
  });
  it("no demo step keeps a beside-the-anchor popover on a phone", () => {
    for (const steps of Object.values(DEMO_STEPS)) {
      for (const s of steps) {
        const { side } = placementFor(s, 375);
        expect(side === "right" || side === "left").toBe(false);
      }
    }
  });
});

describe("isAnchorShown (demo tour skips anchors hidden on this viewport)", () => {
  const el = (rects: number, visible?: boolean): AnchorLike => ({
    getClientRects: () => ({ length: rects }),
    ...(visible === undefined ? {} : { checkVisibility: () => visible }),
  });
  it("a missing anchor is not shown", () => {
    expect(isAnchorShown(null)).toBe(false);
    expect(isAnchorShown(undefined)).toBe(false);
  });
  it("display:none on the anchor or an ancestor (no client rects) is not shown", () => {
    expect(isAnchorShown(el(0))).toBe(false);
    expect(isAnchorShown(el(0, true))).toBe(false);
  });
  it("a laid-out anchor is shown; checkVisibility, where present, has the last word", () => {
    expect(isAnchorShown(el(1))).toBe(true); // no checkVisibility (older Safari) → rects decide
    expect(isAnchorShown(el(1, true))).toBe(true);
    expect(isAnchorShown(el(1, false))).toBe(false); // e.g. visibility:hidden
  });
  it("asks checkVisibility to honour the visibility property", () => {
    let opts: unknown;
    isAnchorShown({ getClientRects: () => ({ length: 1 }), checkVisibility: (o) => ((opts = o), true) });
    expect(opts).toEqual({ visibilityProperty: true });
  });
});

describe("selectorFor (phone stand-in anchors)", () => {
  const step = { selector: '[data-tour="a"]', phoneTarget: '[data-tour="b"]' };
  it.each<[number, string | undefined]>([
    [375, '[data-tour="b"]'],
    [767, '[data-tour="b"]'],
    [768, '[data-tour="a"]'],
    [1280, '[data-tour="a"]'],
  ])("at %ipx → %s", (width, expected) => {
    expect(selectorFor(step, width)).toBe(expected);
  });
  it("a step without a phoneTarget keeps its selector everywhere; a centered step has none", () => {
    expect(selectorFor({ selector: '[data-tour="a"]' }, 375)).toBe('[data-tour="a"]');
    expect(selectorFor({}, 375)).toBeUndefined();
  });
  it("the Timeline priority step points at the agenda's rank-1 row on phones", () => {
    const s = DEMO_STEPS["plan-timeline"].find((x) => x.selector === '[data-tour="tl-priority"]');
    expect(s && selectorFor(s, 375)).toBe('[data-tour="tl-agenda"]');
    expect(s && selectorFor(s, 1280)).toBe('[data-tour="tl-priority"]');
  });
});

describe("demo tour vs anchors hidden on phones", () => {
  // These anchors sit in `hidden md:*` wrappers (M2) — on a phone the controller
  // drops their steps via isAnchorShown. Pin both halves so they can't drift apart.
  const selectors = Object.values(DEMO_STEPS).flat().map((s) => s.selector);
  const demo = read("components/DemoExperience.tsx");
  it.each(["dash-week", "dash-progress", "plan-views", "tl-gantt", "tl-legend"])("%s is a tour step", (anchor) => {
    expect(selectors).toContain(`[data-tour="${anchor}"]`);
  });
  it("the controller resolves anchors per viewport and picks the first SHOWN match", () => {
    expect(demo).toMatch(/selectorFor\(s, viewportWidth\)/);
    expect(demo).toMatch(/querySelectorAll<HTMLElement>\(sel\)\)\.find\(isAnchorShown\)/);
    // never a bare querySelector for an anchor (it can return a hidden twin)
    expect(demo).not.toMatch(/document\.querySelector\(/);
  });
});

// Desktop must render exactly as before (#39 review): a 44px `tap` target may be
// unconditional ONLY on an element that is itself phone-only (`md:hidden`);
// everywhere else it is scoped to phones as `max-md:tap`.
describe("grep guards: tap targets are phone-only", () => {
  const FILES = [
    "components/AuthFlow.tsx",
    "components/ConnectionsForm.tsx",
    "components/SchoolPicker.tsx",
    "components/SettingsForm.tsx",
    "components/AccountForm.tsx",
    "components/DemoExperience.tsx",
    "components/BillingScreenActions.tsx",
    "components/BillingCard.tsx",
    "components/KanbanBoard.tsx",
    "app/welcome/card/page.tsx",
    "app/billing/past-due/page.tsx",
    "app/billing/canceled/page.tsx",
  ];
  it.each(FILES)("%s: every unscoped `tap` sits on a phone-only element", (file) => {
    for (const tokens of classLists(withoutPhoneOnlyNavs(read(file)))) {
      if (tokens.includes("tap")) expect(tokens).toContain("md:hidden");
    }
  });
});

describe("grep guards: phone forms", () => {
  const auth = read("components/AuthFlow.tsx");
  it("every AuthFlow control except the tall role cards gets a phone tap target", () => {
    const cs = controls(auth);
    expect(cs.length).toBeGreaterThanOrEqual(7);
    for (const c of cs) {
      if (c.tokens.includes("card")) continue; // RoleCard: p-5 + a 44px icon, already ≥44px
      expect(c.tokens).toContain("max-md:tap");
    }
  });
  it("AuthFlow's trial-terms guard string is unchanged", () => {
    expect(auth).toContain('role === "student" && mode === "signup" && trialTerms && (');
  });

  const conn = read("components/ConnectionsForm.tsx");
  it("ConnectionsForm has a phone-only, muted 13px laptop hint", () => {
    expect(conn).toMatch(/className="(?=[^"]*\bmd:hidden\b)(?=[^"]*text-\[13px\])(?=[^"]*\btext-muted\b)[^"]*"[^>]*>[^<]*laptop/i);
  });
  it("ConnectionsForm's Paste is feature-checked, phone-only, and fails calmly", () => {
    expect(conn).toMatch(/typeof navigator\.clipboard\?\.readText === "function"/);
    const paste = conn.match(/\{canPaste && \(\s*<button[^>]*className="([^"]*)"/);
    expect(paste?.[1].split(/\s+/)).toContain("md:hidden");
    // denied / failed / empty all land in the catch → the calm line
    expect(conn).toMatch(/if \(!text\) throw/);
    expect(conn).toMatch(/catch \{[^}]*setPasteFailed\(true\)/);
    expect(conn).toMatch(/\{pasteFailed && \(\s*<p className="(?=[^"]*\bmd:hidden\b)(?=[^"]*text-\[13px\])(?=[^"]*\btext-muted\b)[^"]*"[^>]*>\s*[^<]*clipboard/i);
  });

  const picker = read("components/SchoolPicker.tsx");
  it("SchoolPicker selects on a stationary touch tap and keeps the mouse path", () => {
    expect(picker).toMatch(/onTouchEnd=\{/);
    expect(picker).toMatch(/e\.preventDefault\(\);\s*choose\(s\)/); // tap handled once, input keeps focus
    expect(picker).toMatch(/Math\.abs\([^)]*\) > 10/); // a scroll is not a tap
    expect(picker).toMatch(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
    const list = classLists(picker).find((t) => t.includes("max-h-[50dvh]"));
    expect(list).toContain("md:max-h-72"); // desktop height unchanged
  });

  it("Settings: whole-day fields get the numeric keypad, the 0.5-step field the decimal one", () => {
    const settings = read("components/SettingsForm.tsx");
    const fields = [...settings.matchAll(/step="([\d.]+)"/g)].map((m) => m[1]);
    const modes = [...settings.matchAll(/inputMode="(\w+)"/g)].map((m) => m[1]);
    expect(modes).toEqual(fields.map((st) => (st.includes(".") ? "decimal" : "numeric")));
  });
});

describe("grep guards: demo runs in the phone shell", () => {
  const demo = read("components/DemoExperience.tsx");
  const lists = classLists(demo);
  it("renders the ONE tab list (TAB_ITEMS) in a phone-only nav", () => {
    expect(demo).toMatch(/import \{ TAB_ITEMS \} from "@\/components\/navItems"/);
    expect(demo).toMatch(/<nav aria-label="Demo sections" className="[^"]*\bmd:hidden\b/);
    expect(demo).toContain("TAB_ITEMS.map(");
  });
  it("hides its fake sidebar below md", () => {
    const aside = demo.match(/<aside className="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    expect(aside).toEqual(expect.arrayContaining(["hidden", "md:flex"]));
  });
  it("the tab bar drives the demo router, never the real one", () => {
    expect(demo).not.toMatch(/from "next\/navigation"/);
    expect(demo).not.toMatch(/from "next\/link"/);
  });
  it("tour placement goes through placementFor", () => {
    expect(demo).toMatch(/placementFor\(s, viewportWidth\)/);
  });
  it("phone-only layout tweaks are scoped (desktop main/pill unchanged)", () => {
    const flat = lists.flat();
    expect(flat).not.toContain("overflow-x-hidden");
    expect(flat).toContain("max-md:overflow-x-hidden");
    expect(flat).toContain("max-md:max-w-[calc(100vw-2rem)]");
  });
});

describe("grep guards: admin boards on phones", () => {
  const board = read("components/KanbanBoard.tsx");
  it("carries a phone-only, muted 13px laptop note", () => {
    expect(board).toMatch(/className="(?=[^"]*\bmd:hidden\b)(?=[^"]*text-\[13px\])(?=[^"]*\btext-muted\b)[^"]*"[^>]*>[^<]*Best on a laptop/);
  });
  it("every hover-only reveal also has hover-reveal (touch users see row actions)", () => {
    const hidden = classLists(board).filter((t) => t.includes("opacity-0") && t.some((x) => /hover:opacity-100$/.test(x)));
    expect(hidden.length).toBeGreaterThan(0);
    for (const t of hidden) expect(t).toContain("hover-reveal");
  });
});
