// Ticket #39 (M3): Classes, class page, grade calculator, assignment page and
// Study on phones. Grep guards so the phone affordances (thumb-zone action bar,
// overflow-safe Canvas brief, wrapping grade rows, scrolling study tabs, notes
// sheets) can't be quietly undone. The checks look at the class TOKENS on the
// element that carries a marker, not at attribute order or exact source lines,
// so harmless reformatting doesn't trip them. Phone-only classes use the
// `max-md:` variant so desktop stays as it was; `tap` is the shell's 44px target.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const read = (p: string) => readFileSync(p, "utf8");

/** The JSX opening tag (`<tag … >`) that contains `marker` — brace/quote aware,
 *  so `=>` inside attribute expressions doesn't end it early. */
function openingTag(src: string, marker: string | RegExp, from = 0): string {
  const idx = typeof marker === "string" ? src.indexOf(marker, from) : src.slice(from).search(marker) + from;
  if (idx < from) throw new Error(`marker not found: ${marker}`);
  let start = idx;
  while (start > 0 && !(src[start] === "<" && /[A-Za-z]/.test(src[start + 1] ?? ""))) start--;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unterminated tag");
}
/** Every whitespace/quote/brace-separated token in a tag (class names included). */
const tokens = (tag: string) => new Set(tag.split(/[\s"'`{}]+|\$\{/).filter(Boolean));
const hasTap = (tag: string) => tokens(tag).has("tap") || tokens(tag).has("max-md:tap");

describe("AssignmentPage (phone action bar + safe brief)", () => {
  const src = read("components/AssignmentPage.tsx");

  it("has a phone-only fixed action bar above the tab bar with Open in Canvas", () => {
    const bar = openingTag(src, "bg-surface/95");
    const t = tokens(bar);
    for (const c of ["fixed", "md:hidden", "backdrop-blur", "border-t", "bottom-[calc(56px+env(safe-area-inset-bottom))]"]) expect(t.has(c), c).toBe(true);
    const barBody = src.slice(src.indexOf(bar), src.indexOf("function ExternalIcon"));
    expect(barBody).toContain("Open in Canvas");
    expect(hasTap(openingTag(barBody, "btn-primary"))).toBe(true);
  });

  it("mounts exactly ONE MarkDoneButton (one state): inline at md+, pinned into the bar on phones", () => {
    expect((src.match(/import[^;]*\bMarkDoneButton\b[^;]*;/g) ?? []).length).toBe(1);
    expect((src.match(/<MarkDoneButton\b/g) ?? []).length).toBe(1);
    const use = src.indexOf("<MarkDoneButton");
    const wrapperStart = src.lastIndexOf("<span", use);
    const wrapper = openingTag(src, "<span", wrapperStart);
    const t = tokens(wrapper);
    for (const c of ["md:contents", "max-md:fixed", "max-md:[&>button]:tap", "max-md:[&>button]:w-full"]) expect(t.has(c), c).toBe(true);
    expect(src).not.toMatch(/\/api\/assignment\/done/); // the logic stays in calendar/parts
  });

  it("wraps the brief in a `brief` container: images/embeds fit everywhere, tables/code scroll on phones", () => {
    const wrap = openingTag(src, /className="brief\b/);
    const t = tokens(wrap);
    for (const c of ["[&_img]:max-w-full", "[&_img]:h-auto", "[&_iframe]:max-w-full", "max-md:[&_table]:block", "max-md:[&_table]:overflow-x-auto", "max-md:[&_pre]:overflow-x-auto"]) {
      expect(t.has(c), c).toBe(true);
    }
    // desktop table layout untouched
    expect(t.has("[&_table]:block")).toBe(false);
    // the sanitized HTML renders inside the wrapper
    expect(src.slice(src.indexOf(wrap)).search(/dangerouslySetInnerHTML/)).toBeGreaterThan(0);
  });

  it("still has exactly one dangerouslySetInnerHTML, fed by safeHtml", () => {
    expect((src.match(/dangerouslySetInnerHTML/g) ?? []).length).toBe(1);
    expect(src).toMatch(/dangerouslySetInnerHTML=\{\{\s*__html:\s*safeHtml\s*\}\}/);
  });

  it("pads the page on phones so the bar never covers content", () => {
    expect(src).toContain("max-md:pb-20");
  });
});

describe("GradeCalculator (readable at 375px)", () => {
  const src = read("components/GradeCalculator.tsx");
  it("no fixed 120px name column; the weighted row is a grid whose bar gets its own phone row", () => {
    expect(src).not.toContain("w-[120px]");
    const bar = openingTag(src, "order-last");
    const t = tokens(bar);
    expect(t.has("col-span-3")).toBe(true);
    expect(t.has("md:order-none")).toBe(true);
  });
  it("phone stat tiles lead; the what-if sliders stay behind the Adjust toggle", () => {
    const tiles = openingTag(src, "grid-cols-2");
    expect(tokens(tiles).has("md:hidden")).toBe(true);
    expect(src).toContain("Current grade");
    expect(src).toMatch(/showWhatIf\s*&&/);
  });
  it("range thumbs are touch-sized and token-coloured; desktop slider width unchanged", () => {
    const range = openingTag(src, 'type="range"');
    const t = tokens(range);
    expect(t.has("accent-accent")).toBe(true);
    expect(t.has("max-md:h-11")).toBe(true);
    expect(src).not.toMatch(/accentColor/);
    // the name beside it must flex from 0 at md+ (as before), not from its content width
    const name = openingTag(src, "basis-full");
    expect(tokens(name).has("md:basis-0")).toBe(true);
  });
  it("one reading of the solver result feeds both the phone tile and the desktop line", () => {
    expect((src.match(/function neededView\(/g) ?? []).length).toBe(1);
    expect((src.match(/=\s*neededView\(needed/g) ?? []).length).toBe(1);
  });
});

describe("StudyTools (thumb- and keyboard-friendly)", () => {
  const src = read("components/StudyTools.tsx");
  it("tabs are a snap-scrolling segmented control with 44px, focus-ringed tabs", () => {
    const list = tokens(openingTag(src, 'role="tablist"'));
    expect(list.has("snap-x")).toBe(true);
    expect(list.has("overflow-x-auto")).toBe(true);
    expect(list.has("p-1")).toBe(true); // room for the focus ring inside the scroller
    const tab = openingTag(src, 'role="tab"');
    expect(hasTap(tab)).toBe(true);
    expect(tokens(tab).has("snap-start")).toBe(true);
    expect(tokens(tab).has("focus-visible:ring-2")).toBe(true);
  });
  it("tablist has arrow-key navigation with a roving tabindex", () => {
    expect(openingTag(src, 'role="tablist"')).toMatch(/onKeyDown=/);
    expect(src).toContain('"ArrowRight"');
    expect(src).toContain('"ArrowLeft"');
    expect(openingTag(src, 'role="tab"')).toMatch(/tabIndex=/);
  });
  it("answer buttons are full-width tap targets; Regenerate has a 44px hit area", () => {
    const mcq = openingTag(src, "answerMcq(i)");
    expect(hasTap(mcq)).toBe(true);
    expect(tokens(mcq).has("w-full")).toBe(true);
    const tf = openingTag(src, "answerTf(v)");
    expect(hasTap(tf)).toBe(true);
    expect(tokens(tf).has("max-md:w-full")).toBe(true);
    const regen = src.slice(src.indexOf("function RegenButton"));
    expect(hasTap(openingTag(regen, "<button"))).toBe(true);
  });
});

describe("NotesSection (sheets on phones)", () => {
  const src = read("components/NotesSection.tsx");
  it("uses the shared Sheet for its modals on phones", () => {
    expect(src).toMatch(/import\s*\{[^}]*\bSheet\b[^}]*\}\s*from\s*"@\/components\/Sheet"/);
    expect(src).toMatch(/<Sheet\b/);
    expect(src).toMatch(/useIsPhone\(\)/);
  });
  it("photo input offers camera OR library (no `capture`) and the strip snap-scrolls", () => {
    const input = openingTag(src, 'accept="image/*"');
    expect(input).not.toMatch(/\bcapture\b/);
    const strip = tokens(openingTag(src, /className="[^"]*snap-x/));
    expect(strip.has("overflow-x-auto")).toBe(true);
  });
});

describe("Classes (course menu, grid, class page)", () => {
  it("the course kebab is a 44px target and becomes a Sheet on phones", () => {
    const src = read("components/CourseExclude.tsx");
    expect(hasTap(openingTag(src, 'aria-label="Class options"'))).toBe(true);
    expect(src).toMatch(/useIsPhone\(\)/);
    expect(src).toMatch(/<Sheet\b/);
  });
  it("course card titles wrap to two lines on phones and the pill row wraps below", () => {
    const src = read("components/CourseGrid.tsx");
    const title = tokens(openingTag(src, "<h3"));
    for (const c of ["max-md:line-clamp-2", "max-md:whitespace-normal", "truncate"]) expect(title.has(c), c).toBe(true);
    expect(src).toContain("max-md:flex-wrap");
  });
  it("class page: header stacks on phones, tabs are tap targets, rows are at least 44px", () => {
    const src = read("components/CoursePage.tsx");
    expect(tokens(openingTag(src, "<h1")).has("max-md:break-words")).toBe(true);
    expect(src).toContain("max-md:flex-col");
    expect(hasTap(openingTag(src, 'role="tab"'))).toBe(true);
    expect(tokens(openingTag(src, "itemHref(")).has("min-h-11")).toBe(true);
  });
  it("Study hub hero title is capped on phones", () => {
    const src = read("components/StudyView.tsx");
    const hero = tokens(openingTag(src, "leading-[1.1]"));
    for (const c of ["max-md:text-2xl", "max-md:line-clamp-3", "text-[2rem]"]) expect(hero.has(c), c).toBe(true);
  });
});
