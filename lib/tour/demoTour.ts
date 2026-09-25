// Content + config for the first-run DEMO walkthrough (see app/demo +
// components/DemoExperience). Client-safe — NO node imports.
//
// The tour walks the new app surfaces: Dashboard → Plan (List · Calendar ·
// Timeline) → Study → Courses. Plan's three sub-views are separate tour "pages"
// (the sidebar still shows one "Plan"). A few SHORT, specific coachmarks per page
// teach what things mean and how to use them — depth from coverage, not long copy
// (each body is one tight, benefit-first line). Every `selector` matches a
// data-tour="..." anchor in the matching component; the controller keeps only the
// steps whose anchor is on screen, so a missing anchor is skipped, never broken.

export type DemoView =
  | "dashboard"
  | "plan-list"
  | "plan-calendar"
  | "plan-timeline"
  | "study"
  | "courses";

export const DEMO_VIEW_ORDER: DemoView[] = [
  "dashboard",
  "plan-list",
  "plan-calendar",
  "plan-timeline",
  "study",
  "courses",
];

// Used for the tour's "Next: X →" button (per tour page).
export const DEMO_VIEW_LABEL: Record<DemoView, string> = {
  dashboard: "Dashboard",
  "plan-list": "Plan",
  "plan-calendar": "Calendar",
  "plan-timeline": "Timeline",
  study: "Study",
  courses: "Courses",
};

// `side`/`align` mirror driver.js's popover placement. We set them explicitly on
// every anchored step so the popover never lands on top of a large cutout or under
// the fixed 44px demo bar. (driver.js Side: top|right|bottom|left|over; Alignment:
// start|center|end.)
export type TourSide = "top" | "right" | "bottom" | "left" | "over";
export type TourAlign = "start" | "center" | "end";

/** Below this viewport width (the `md` breakpoint) the demo runs in the phone
 *  shell, where there is no room beside an anchor for a 320px popover. */
export const PHONE_MAX_WIDTH = 768;

/** Phone placement (#39): a popover asked to sit BESIDE its anchor (right/left)
 *  goes BELOW it on a phone-width viewport; every other side, and every side at
 *  md+, is kept. Pure — the caller reads `window.innerWidth` once at tour start. */
export function sideFor(desired: TourSide | undefined, viewportWidth: number): TourSide | undefined {
  if (viewportWidth < PHONE_MAX_WIDTH && (desired === "right" || desired === "left")) return "bottom";
  return desired;
}

/** The step's popover placement for this viewport: a side flipped by `sideFor`
 *  is centered under the anchor; otherwise the step's own side/align stand. */
export function placementFor(
  step: Pick<TourStep, "side" | "align">,
  viewportWidth: number
): { side?: TourSide; align?: TourAlign } {
  const side = sideFor(step.side, viewportWidth);
  const flipped = side !== step.side;
  return { side, align: flipped ? "center" : step.align };
}

/** The slice of a DOM Element `isAnchorShown` reads (structural, so it's testable
 *  without a DOM). `checkVisibility` is optional: older Safari lacks it. */
export interface AnchorLike {
  getClientRects(): { length: number };
  checkVisibility?: (options?: { visibilityProperty?: boolean }) => boolean;
}

/** Is a tour anchor actually rendered? An element hidden by `display:none` on
 *  itself OR any ancestor (e.g. `hidden md:block` on a phone) has no client
 *  rects; `checkVisibility` (where supported) also catches `visibility:hidden`.
 *  A missing element is not shown. The controller drops steps that fail this,
 *  so a desktop-only anchor on a phone is skipped rather than spotlighting
 *  nothing. */
export function isAnchorShown(el: AnchorLike | null | undefined): boolean {
  if (!el) return false;
  if (el.getClientRects().length === 0) return false;
  return typeof el.checkVisibility === "function" ? el.checkVisibility({ visibilityProperty: true }) : true;
}

/** The anchor selector for this viewport: a step's `phoneTarget` (the phone
 *  shell's stand-in for a desktop-only anchor) below `md`, else its `selector`. */
export function selectorFor(step: Pick<TourStep, "selector" | "phoneTarget">, viewportWidth: number): string | undefined {
  if (viewportWidth < PHONE_MAX_WIDTH && step.phoneTarget) return step.phoneTarget;
  return step.selector;
}

export interface TourStep {
  selector?: string; // undefined → a centered popover (no element highlighted)
  /** Phone-shell anchor used instead of `selector` below `md` (see selectorFor). */
  phoneTarget?: string;
  title: string;
  body: string;
  side?: TourSide; // popover placement relative to the anchor
  align?: TourAlign;
}

// The opening welcome — a centered React modal with a fork ("Take the tour" /
// "Explore on my own"), NOT a driver step.
export const WELCOME_STEP = {
  title: "Everything from Canvas, in one place 👋",
  body: "This is Navo running on sample classes — poke around, you can't break anything.",
};

// Per-page coachmarks. A few short, specific steps so the demo teaches each one.
export const DEMO_STEPS: Record<DemoView, TourStep[]> = {
  dashboard: [
    // dash-focus wraps the big violet Focus card + do-next list (tall) → popover to
    // the RIGHT so it sits beside the card, never over it or under the bar.
    { selector: '[data-tour="dash-focus"]', title: "What to do first", body: "Your #1 task, picked from everything due — no guessing where to start.", side: "right", align: "start" },
    { selector: '[data-tour="dash-progress"]', title: "Today at a glance", body: "This ring fills in as you finish today's work.", side: "left", align: "start" },
    { selector: '[data-tour="dash-week"]', title: "How heavy is the week", body: "A quick read on the week ahead — easy, moderate, or hard.", side: "bottom", align: "start" },
    { selector: '[data-tour="dash-tests"]', title: "Tests coming up", body: "Your next quizzes and exams, each with a study plan ready.", side: "left", align: "start" },
  ],
  "plan-list": [
    { selector: '[data-tour="plan-views"]', title: "Your work, three ways", body: "List, Calendar, or Timeline — switch views anytime up here.", side: "bottom", align: "end" },
    // Anchored to the short intro line above the list (see PlanSurface), so the
    // cutout is small and the popover points down at the ranked list.
    { selector: '[data-tour="plan-list"]', title: "The do-next order", body: "Everything ranked by what to tackle first — deadlines, points, and risk, not just the clock.", side: "bottom", align: "start" },
  ],
  "plan-calendar": [
    { selector: '[data-tour="cal-views"]', title: "Day, week, or month", body: "See the same work on a calendar, however you like.", side: "bottom", align: "end" },
    { selector: '[data-tour="cal-day"]', title: "Deadlines on their day", body: "Each assignment lands on the day it's due, color-coded by class — click any to open it.", side: "right", align: "start" },
  ],
  "plan-timeline": [
    // The timeline was the most-confusing page in testing, so lead with a brief,
    // centered intro (no anchor) → then the KEY → then the timeline itself.
    { title: "Your week, mapped out", body: "The timeline lays your classes out across the next 7 days so you can see what's coming and when to start. Here's how to read it." },
    { selector: '[data-tour="tl-legend"]', title: "Start with the key", body: "Each color is a type of work — assignment, quiz, or exam; ◆ marks a due date, and the striped bars are time set aside to study.", side: "top", align: "start" },
    // tl-gantt is wide; place the popover above it (it sits below the banner/summary).
    { selector: '[data-tour="tl-gantt"]', title: "Now the timeline", body: "One row per class; each bar is the days planned to work on something — click a bar for details.", side: "top", align: "start" },
    // Phones get the Timeline as an agenda (no Gantt): its rank-1 row carries tl-agenda.
    { selector: '[data-tour="tl-priority"]', phoneTarget: '[data-tour="tl-agenda"]', title: "Done before it's due", body: "Work is scheduled to finish on time. The number is its priority order.", side: "bottom", align: "start" },
  ],
  study: [
    { selector: '[data-tour="study-featured"]', title: "Prep for any test", body: "Your next quiz or exam, front and center — with a study plan ready.", side: "bottom", align: "start" },
    { selector: '[data-tour="study-tools"]', title: "Notes → a study guide", body: "We turn its Canvas readings into a guide and practice questions. Pick an answer to try it.", side: "top", align: "start" },
  ],
  courses: [
    { selector: '[data-tour="courses-card"]', title: "Every class in one place", body: "A card per class, each led by your real grade. Open one for the full list — plus a calculator that shows exactly what you need on what's left.", side: "right", align: "start" },
  ],
};

// Shown after the last page's step (a React modal, not a driver popover).
export const FINALE_STEP = {
  title: "That's Navo",
  body: "Connect Canvas to swap this sample data for your real Science, Math, and History work.",
};

// Shown once on the REAL dashboard right after the demo ends (WelcomeNudge),
// pointing at the "Connect Canvas" button.
export const CONNECT_STEP = {
  title: "Now make it yours",
  body: "Connect your Canvas and Navo turns your real coursework into this same do-next plan.",
};
