// Ticket #138 (UI audit round 1): accessibility guards for the shared
// primitives — global focus rings, the one dialog primitive (Sheet), the
// calendar/parts building blocks, the Sidebar account menu and the app shell's
// skip link. Source guards like tests/mobileShell: they assert that the
// attributes and rules exist where they must, never whole class strings.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const read = (p: string) => readFileSync(p, "utf8");
/** Source with line and block comments removed (for structure checks, so a
 *  comment that mentions `<Link>` can't open a fake element). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
/** Slice of `src` from the first `from` up to the next `to` after it. */
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  expect(a, `missing ${from}`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(to, a + from.length);
  expect(b, `missing ${to} after ${from}`).toBeGreaterThan(a);
  return src.slice(a, b);
};
/** Every static-ish className string in a TSX source (plain strings and template
 *  literals), as whitespace-split token sets. */
const classGroups = (src: string) =>
  [...src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => new Set((m[1] ?? m[2]).split(/[\s"'`{}$]+/).filter(Boolean)));
/** The source from every `<tag` to its next `</tag>` (these files never nest
 *  a tag inside itself or self-close a Link/a). */
const elementBodies = (src: string, tag: string) => {
  const out: string[] = [];
  const re = new RegExp(`<${tag}[\\s>]`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = src.indexOf(`</${tag}>`, m.index);
    if (end >= 0) out.push(src.slice(m.index, end));
  }
  return out;
};

describe("globals.css: designed keyboard focus", () => {
  const css = read("app/globals.css");
  it("a zero-specificity focus-visible rule covers links and buttons, in @layer base, with a solid accent outline", () => {
    const base = between(css, "@layer base {", "\n}\n");
    expect(base).toMatch(/:where\(a, button, \[role="button"\][^)]*\):focus-visible\s*\{/);
    expect(base).toMatch(/outline: 2px solid rgb\(var\(--accent\)\);/);
    expect(base).toMatch(/outline-offset: 2px;/);
  });
  it(".btn draws its own two-tone ring on focus-visible", () => {
    const btn = between(css, "  .btn {", "}");
    for (const t of ["focus-visible:outline-none", "focus-visible:ring-2", "focus-visible:ring-accent", "focus-visible:ring-offset-2", "focus-visible:ring-offset-surface"]) {
      expect(btn.split(/[\s;]+/), t).toContain(t);
    }
  });
  it("never removes the outline without drawing a ring in the same rule", () => {
    const rules = css.split("}");
    for (const r of rules) {
      if (/(^|[\s:])outline-none\b/.test(r) || /outline:\s*(none|0)\b/.test(r)) {
        expect(/ring-\d|ring-accent/.test(r), `bare outline-none in: ${r.trim().slice(0, 120)}`).toBe(true);
      }
    }
  });
  it("keeps the phone foundations that other guards pin", () => {
    expect(/\.tap\s*\{\s*@apply min-h-11 min-w-11;/.test(css)).toBe(true);
    expect(/@media \(hover: none\)\s*\{\s*\.hover-reveal/.test(css)).toBe(true);
    expect(css.includes(".pb-safe")).toBe(true);
  });
});

describe("token plumbing other builders rely on", () => {
  const css = read("app/globals.css");
  const tw = read("tailwind.config.ts");
  it("--on-accent is defined in both themes and exposed as accent-on with alpha support", () => {
    expect(css.match(/--on-accent:\s*\d+ \d+ \d+;/g)?.length).toBe(2);
    expect(tw).toMatch(/on: v\("--on-accent"\)/);
    expect(tw).toMatch(/<alpha-value>/); // so text-accent-on/80 works
  });
  it("warning has a soft fill in both themes and in the config", () => {
    expect(css.match(/--warning-soft:\s*\d+ \d+ \d+;/g)?.length).toBe(2);
    expect(tw).toMatch(/warning: \{ DEFAULT: v\("--warning"\), soft: v\("--warning-soft"\) \}/);
  });
});

describe("Sheet: the ONE dialog primitive", () => {
  const src = read("components/Sheet.tsx");
  it("is labelled by its title and returns focus to the opener on close", () => {
    expect(src).toContain("aria-labelledby={title ? titleId : undefined}");
    expect(src).toContain("<h2 id={titleId}");
    expect(src).toContain("const opener = document.activeElement");
    expect(src).toContain("opener?.focus?.()");
  });
  it("exposes isSheetOpen() for popovers that handle Escape themselves", () => {
    expect(src).toContain("export function isSheetOpen(): boolean");
    expect(src).toContain("return openSheets.length > 0;");
  });
  it("moves focus in, traps Tab and closes on Escape", () => {
    expect(src).toContain("panel?.focus()");
    expect(src).toMatch(/e\.key === "Escape"/);
    expect(src).toMatch(/e\.key !== "Tab"/);
  });
});

describe("calendar/parts.tsx", () => {
  const src = read("components/calendar/parts.tsx");
  it("has no hand-made dialogs: every role=dialog comes from <Sheet", () => {
    expect(src).not.toMatch(/role="dialog"/);
    expect(src).not.toMatch(/fixed inset-0 z-(40|50)[^"`]*bg-black/);
    for (const [a, b] of [
      ["export function ItemDetail", "function DetailRow"],
      ["export function DayPeek", "export function AttentionBanner"],
    ]) {
      const body = between(src, a, b);
      // both width branches render through Sheet, and neither keeps a private Escape listener
      expect(body.match(/<Sheet\b/g)?.length, a).toBe(2);
      expect(body, a).not.toMatch(/addEventListener\("keydown"/);
    }
  });
  it("text-faint only on decorative marks (the DoneCheck tick), never on content rows", () => {
    const busy = between(src, "export function BusyRow", "export function ItemDetail");
    expect(busy).not.toContain("text-faint");
    for (const g of classGroups(src)) {
      if (g.has("text-faint")) expect(g.has("opacity-0") && g.has("hover-reveal"), [...g].join(" ")).toBe(true);
    }
  });
  it("no interactive control nested inside a link", () => {
    for (const tag of ["Link", "a"]) {
      for (const body of elementBodies(code(src), tag)) {
        expect(body, body.slice(0, 80)).not.toMatch(/<button\b|<DoneCheck\b|<input\b/);
      }
    }
  });
  it("DoneCheck is ready for the sibling row pattern (relative z-10 above the link's ::after)", () => {
    const dc = between(src, "export function DoneCheck", "export function MarkDoneButton");
    const btn = classGroups(dc).find((g) => g.has("group/done"));
    expect(btn).toBeDefined();
    expect(btn!.has("relative")).toBe(true);
    expect(btn!.has("z-10")).toBe(true);
  });
  it("StudyLeadEditor ties its label to the input and announces saved/error text", () => {
    const ed = between(src, "export function StudyLeadEditor", "const EFFORT_PRESETS");
    expect(ed).toContain("const inputId = useId();");
    expect(ed).toMatch(/<label htmlFor=\{inputId\}/);
    expect(ed).toMatch(/<input\s+id=\{inputId\}/);
    // always-mounted regions, not rendered together with their text
    expect(ed).toMatch(/<span aria-live="polite"[^>]*>\s*\{saved \? "Re-planned ✓" : ""\}/);
    expect(ed).toMatch(/<div role="alert">\{err && /);
    // saved clears on the next edit and at the start of every apply()
    expect(ed.match(/setSaved\(false\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("disclosures report their state", () => {
    expect(between(src, "export function AttentionBanner", "export function RecommendedOrder")).toContain("aria-expanded={open}");
    expect(between(src, "export function PeriodSummary", "export function PeriodToolbar")).toContain("aria-expanded={open}");
  });
  it("the view tablist is labelled and keyboard-operable via the shared nextIndex rule", () => {
    const tb = between(src, "export function PeriodToolbar", "export function LoadHint");
    expect(tb).toMatch(/role="tablist" aria-label="Calendar view" onKeyDown=\{onTabKey\}/);
    expect(src).toContain('import { nextIndex } from "@/lib/keyboardNav";');
    expect(tb).toMatch(/nextIndex\(e\.key, [^;]*"horizontal"\)/);
    expect(tb).not.toMatch(/"ArrowRight"|"ArrowLeft"/); // no private copy of the rule
    expect(tb).toMatch(/tabIndex=\{v === view/);
  });
  it("popover Escape handlers yield to an open Sheet (one Escape = one layer) and LoadHint returns focus", () => {
    expect(src).toMatch(/import \{[^}]*\bisSheetOpen\b[^}]*\} from "@\/components\/Sheet"/);
    const lh = between(src, "export function LoadHint", "export function DoneCheck");
    expect(lh).toMatch(/e\.key !== "Escape" \|\| e\.defaultPrevented \|\| isSheetOpen\(\)/);
    expect(lh).toContain("chipRef.current?.focus()");
    const ee = between(src, "export function EffortEditor", "export interface StudyEntry");
    expect(ee).toMatch(/e\.key !== "Escape" \|\| e\.defaultPrevented \|\| isSheetOpen\(\)/);
  });
  it("MarkDoneButton's label names the action, so it carries no aria-pressed", () => {
    const md = between(src, "export function MarkDoneButton", "\n}\n");
    expect(md).not.toMatch(/aria-pressed=/);
    expect(md).toContain('"Mark as done"');
  });
  it("due days go through DueLabel; no hand-formatted due dates", () => {
    expect(src).toContain('import { DueLabel } from "@/components/DueLabel";');
    expect(src).not.toContain("fmtDueLong");
    expect(src).not.toMatch(/dueShort|\.getDay\(\)/);
    expect(src).toMatch(/<DueLabel iso=\{item\.dueAt\}/);
    expect(src).toMatch(/<DueLabel iso=\{s\.dueAt\}/);
  });
});

describe("Sidebar", () => {
  const src = read("components/Sidebar.tsx");
  it("marks the active nav and admin links with aria-current=page", () => {
    expect(src.match(/aria-current=\{[^}]*\? "page" : undefined\}/g)?.length).toBe(2);
  });
  it("the account menu is a real menu: role=menu/menuitem, Escape returns focus, focus moves in", () => {
    expect(src).toContain('role="menu"');
    expect(src.match(/role="menuitem"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(src).toMatch(/e\.key === "Escape"/);
    expect(src).toContain("triggerRef.current?.focus()");
    expect(src).toMatch(/querySelector<HTMLElement>\('\[role="menuitem"\]'\)\?\.focus\(\)/);
    expect(src).toMatch(/nextIndex\(e\.key, [^;]*"vertical"\)/);
    expect(src).not.toMatch(/"ArrowDown"|"ArrowUp"/); // no private copy of the rule
  });
  it("Space activates menu links, and a menu link closes the menu and returns focus before navigating", () => {
    expect(src).toMatch(/e\.key === " " && document\.activeElement instanceof HTMLAnchorElement/);
    expect(src.match(/role="menuitem" tabIndex=\{-1\} onClick=\{closeMenu\}/g)?.length).toBe(2);
  });
  it("ThemeToggle takes the menuitem role as a prop (no runtime DOM patching)", () => {
    expect(src).toContain('<ThemeToggle role="menuitem" tabIndex={-1}');
    expect(src).not.toContain("setAttribute(");
    expect(read("components/ThemeToggle.tsx")).toMatch(/role=\{role\} tabIndex=\{tabIndex\}/);
  });
  it("nav links draw their focus outline inside the box (the nav scrolls and would clip it)", () => {
    expect(src).toContain("focus-visible:outline-offset-[-2px]");
    expect(src).toContain("focus-visible:outline-accent-on");
  });
  it("the trigger's name starts with the visible name, then the role (the rail only shows initials)", () => {
    expect(src).toContain("aria-label={`${userName}, account menu`}");
    expect(src).toContain('aria-haspopup="menu"');
  });
  it("the rail width animates only when motion is OK", () => {
    expect(src).toContain("motion-safe:transition-[width]");
    expect(src).not.toMatch(/(^|[\s"`])transition-\[width\]/);
  });
});

describe("(app) layout: skip link", () => {
  const src = read("app/(app)/layout.tsx");
  it("has a skip link to #main that is hidden until focused", () => {
    expect(src).toMatch(/<a\s+href="#main"/);
    const cls = classGroups(src).find((g) => g.has("focus:not-sr-only"));
    expect(cls).toBeDefined();
    for (const t of ["sr-only", "focus:fixed", "focus:top-[calc(1rem+env(safe-area-inset-top))]", "focus:z-50", "focus:bg-surface", "focus:text-ink"]) expect(cls!.has(t), t).toBe(true);
    expect(src).toContain("Skip to content");
  });
  it("the skip link comes before the shell and <main> is its focusable target", () => {
    expect(src.indexOf('href="#main"')).toBeLessThan(src.indexOf("<Sidebar"));
    expect(src).toMatch(/<main id="main" tabIndex=\{-1\}/);
  });
});

describe("focus rings use the solid accent (the pale accent-ring token is under 3:1)", () => {
  it.each(["components/UndoToast.tsx", "components/GradeCalculator.tsx", "components/KanbanBoard.tsx", "components/Sheet.tsx", "components/Sidebar.tsx", "components/calendar/parts.tsx", "app/(app)/layout.tsx"])("%s", (f) => {
    expect(read(f)).not.toMatch(/ring-accent-ring/);
  });
});
