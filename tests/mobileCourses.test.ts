// Task E: on phones the Courses page is a swipeable one-card carousel with
// Instagram-style dots; md+ keeps the grid. Unit tests for the pure centring
// maths in lib/carousel.ts, plus grep guards so the phone/desktop split (both
// rendered, CSS choosing — no JS width branch) and the carousel affordances
// can't be quietly undone.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dotLabel, nearestIndex } from "@/lib/carousel";

const read = (p: string) => readFileSync(p, "utf8");

describe("nearestIndex (which slide is centred)", () => {
  // 375px scroller: spacer 21.75 + gap 12 → slide 0 starts at 33.75, width
  // 307.5, stride 319.5. Centres are start + width / 2.
  const W = 375;
  const centres = [0, 1, 2, 3].map((i) => 33.75 + i * 319.5 + 307.5 / 2);
  const leftFor = (i: number) => centres[i] - W / 2; // scrollLeft that centres slide i

  it.each([
    ["start (scrollLeft 0)", 0, 0],
    ["slide 1 centred", leftFor(1), 1],
    ["slide 2 centred", leftFor(2), 2],
    ["end (last slide centred)", leftFor(3), 3],
    ["overscroll past the end", leftFor(3) + 500, 3],
    ["negative (iOS rubber-band)", -80, 0],
    ["just under half-way 1→2", leftFor(1) + 319.5 / 2 - 1, 1],
    ["just past half-way 1→2", leftFor(1) + 319.5 / 2 + 1, 2],
    ["a third of the way 0→1", leftFor(0) + 319.5 / 3, 0],
  ])("%s", (_label, scrollLeft, want) => {
    expect(nearestIndex(scrollLeft, centres, W)).toBe(want);
  });

  it("an exact tie goes to the earlier slide", () => {
    expect(nearestIndex(leftFor(1) + 319.5 / 2, centres, W)).toBe(1);
  });
  it("no slides → 0; one slide → 0", () => {
    expect(nearestIndex(123, [], W)).toBe(0);
    expect(nearestIndex(999, [187.5], W)).toBe(0);
  });
});

describe("dotLabel", () => {
  it("is 1-based 'Course N of M'", () => {
    expect(dotLabel(0, 5)).toBe("Course 1 of 5");
    expect(dotLabel(4, 5)).toBe("Course 5 of 5");
    expect(dotLabel(0, 1)).toBe("Course 1 of 1");
  });
});

describe("CourseGrid: carousel below md, grid at md+", () => {
  const src = read("components/CourseGrid.tsx");
  it("renders the carousel inside an md:hidden wrapper", () => {
    expect(src).toContain("<CourseCarousel");
    expect(src).toMatch(/className="md:hidden">\s*<CourseCarousel/);
  });
  it("keeps the desktop grid, hidden below md, with the same columns", () => {
    expect(src).toMatch(/className="hidden md:grid[^"]*\bsm:grid-cols-2\b[^"]*\bxl:grid-cols-3\b/);
  });
  it("both variants get the SAME card elements (one sort, one CourseCard)", () => {
    expect((src.match(/<CourseCard\b/g) ?? []).length).toBe(1);
    expect(src).toMatch(/<CourseCarousel>\{cards\}<\/CourseCarousel>/);
    expect(src).toMatch(/md:grid[^>]*>\{cards\}</);
  });
  it("chooses with CSS, not a JS width check", () => {
    expect(src).not.toMatch(/useIsPhone/);
    expect(src).not.toMatch(/matchMedia/);
  });
});

describe("CourseCarousel affordances", () => {
  const src = read("components/CourseCarousel.tsx");
  it("is a snap-centred, scrollbar-less horizontal scroller", () => {
    for (const c of ["snap-x", "snap-mandatory", "snap-center", "overflow-x-auto", "[scrollbar-width:none]", "[&::-webkit-scrollbar]:hidden"]) expect(src, c).toContain(c);
  });
  it("dims non-centred neighbours, without animation under reduced motion", () => {
    expect(src).toContain("opacity-60");
    expect(src).toContain("motion-reduce:transition-none");
    expect(src).toContain("motion-reduce:scroll-auto");
  });
  it("dots: tap-sized buttons, accent when active, labelled Course N of M", () => {
    expect(src).toMatch(/<button[\s\S]*?aria-label=\{dotLabel\(i, n\)\}/);
    expect(src).toMatch(/className="tap\b/);
    expect(src).toContain('"bg-accent"');
    expect(src).toContain('"bg-line"');
    expect(src).toContain("h-2 w-2");
  });
  it("tracks the centred slide with nearestIndex, only while the phone query matches", () => {
    expect(src).toMatch(/nearestIndex\(/);
    expect(src).toContain('"(max-width: 767px)"');
    expect(src).toMatch(/requestAnimationFrame/);
  });
  it("arrow keys move one slide; no router in the carousel (works in the demo frame)", () => {
    expect(src).toContain('"ArrowRight"');
    expect(src).toContain('"ArrowLeft"');
    expect(src).not.toMatch(/next\/navigation|useRouter/);
  });
  it("no raw hex colours", () => {
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
