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

export interface TourStep {
  selector?: string; // undefined → a centered popover (no element highlighted)
  title: string;
  body: string;
}

// The opening welcome — a centered React modal with a fork ("Take the tour" /
// "Explore on my own"), NOT a driver step.
export const WELCOME_STEP = {
  title: "Everything from Canvas, in one place 👋",
  body: "This is StudyPlan running on sample classes — poke around, you can't break anything.",
};

// Per-page coachmarks. A few short, specific steps so the demo teaches each one.
export const DEMO_STEPS: Record<DemoView, TourStep[]> = {
  dashboard: [
    { selector: '[data-tour="dash-focus"]', title: "What to do first", body: "Your #1 task, picked from everything due — no guessing where to start." },
    { selector: '[data-tour="dash-progress"]', title: "Today at a glance", body: "This ring fills in as you finish today's work." },
    { selector: '[data-tour="dash-week"]', title: "How heavy is the week", body: "A quick read on the week ahead — easy, moderate, or hard." },
    { selector: '[data-tour="dash-tests"]', title: "Tests coming up", body: "Your next quizzes and exams, each with a study plan ready." },
  ],
  "plan-list": [
    { selector: '[data-tour="plan-views"]', title: "Your work, three ways", body: "List, Calendar, or Timeline — switch views anytime up here." },
    { selector: '[data-tour="plan-list"]', title: "The do-next order", body: "Everything ranked by what to tackle first — deadlines, points, and risk, not just the clock." },
  ],
  "plan-calendar": [
    { selector: '[data-tour="cal-views"]', title: "Day, week, or month", body: "See the same work on a calendar, however you like." },
    { selector: '[data-tour="cal-day"]', title: "Deadlines on their day", body: "Each assignment lands on the day it's due, color-coded by class — click any to open it." },
  ],
  "plan-timeline": [
    { selector: '[data-tour="tl-gantt"]', title: "Your whole term", body: "One row per class; each bar is the days set aside to work — click a bar for details." },
    { selector: '[data-tour="tl-priority"]', title: "Done before it's due", body: "Work is scheduled to finish on time. The number is its priority order." },
    { selector: '[data-tour="tl-legend"]', title: "What every mark means", body: "The key decodes the colors — quiz vs exam, ◆ due dates, and striped study time." },
  ],
  study: [
    { selector: '[data-tour="study-featured"]', title: "Prep for any test", body: "Your next quiz or exam, front and center — with a study plan ready." },
    { selector: '[data-tour="study-tools"]', title: "Notes → a study guide", body: "We turn its Canvas readings into a guide and practice questions. Pick an answer to try it." },
  ],
  courses: [
    { selector: '[data-tour="courses-card"]', title: "Every class in one place", body: "A card per course shows what to do next — open one for its full list." },
  ],
};

// Shown after the last page's step (a React modal, not a driver popover).
export const FINALE_STEP = {
  title: "That's StudyPlan",
  body: "Connect Canvas to swap this sample data for your real Science, Math, and History work.",
};

// Shown once on the REAL dashboard right after the demo ends (WelcomeNudge),
// pointing at the "Connect Canvas" button.
export const CONNECT_STEP = {
  title: "Now make it yours",
  body: "Connect your Canvas and StudyPlan turns your real coursework into this same do-next plan.",
};
