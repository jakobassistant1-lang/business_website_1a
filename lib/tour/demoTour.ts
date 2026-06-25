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

export interface TourStep {
  selector?: string; // undefined → a centered popover (no element highlighted)
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
    { selector: '[data-tour="tl-priority"]', title: "Done before it's due", body: "Work is scheduled to finish on time. The number is its priority order.", side: "bottom", align: "start" },
  ],
  study: [
    { selector: '[data-tour="study-featured"]', title: "Prep for any test", body: "Your next quiz or exam, front and center — with a study plan ready.", side: "bottom", align: "start" },
    { selector: '[data-tour="study-tools"]', title: "Notes → a study guide", body: "We turn its Canvas readings into a guide and practice questions. Pick an answer to try it.", side: "top", align: "start" },
  ],
  courses: [
    { selector: '[data-tour="courses-card"]', title: "Every class in one place", body: "A card per course shows what to do next — open one for its full list.", side: "right", align: "start" },
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
