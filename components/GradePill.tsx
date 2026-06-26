// The student's course grade as a compact pill — shared by the Courses grid and
// the class-detail header so the two never drift. Three honest states only: a real
// Canvas total, an explicit "hidden by the instructor", or "no grades yet". Never
// a guessed/estimated number (see lib/courseGrade).

import { gradeBand, type CourseGrade, type GradeBand } from "@/lib/courseGrade";

// Band → background tint only. The number itself stays text-ink for crisp AA
// contrast (band-colored text on a same-hue soft fill ran ~2.8:1 — too low for
// the card's hero number); the tint is the calm at-a-glance signal. No amber:
// A green, B violet (brand accent), C violet-grey (warning), D/F red.
const BAND_BG: Record<GradeBand, string> = {
  high: "bg-success-soft",
  good: "bg-accent-soft",
  fair: "bg-warning-soft",
  low: "bg-danger-soft",
};

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4.5" y="11" width="15" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function GradePill({ grade, size = "md" }: { grade: CourseGrade; size?: "md" | "lg" }) {
  const lg = size === "lg";
  if (grade.state === "graded" && grade.score != null) {
    return (
      <span className={`inline-flex shrink-0 items-baseline gap-1.5 rounded-xl ${lg ? "px-3.5 py-2" : "px-3 py-1.5"} ${BAND_BG[gradeBand(grade.score)]}`}>
        <span className={`${lg ? "text-[22px]" : "text-[18px]"} font-bold leading-none tabular-nums text-ink`}>{Math.round(grade.score)}%</span>
        {grade.letter && <span className={`${lg ? "text-[15px]" : "text-[13px]"} font-semibold leading-none text-muted`}>{grade.letter}</span>}
      </span>
    );
  }
  if (grade.state === "hidden") {
    return (
      <span
        title="Your instructor hides total grades for students in Canvas, so there's no grade to show."
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-surface-soft ${lg ? "px-3.5 py-2 text-[13px]" : "px-3 py-1.5 text-[12px]"} font-medium text-muted`}
      >
        <LockIcon /> Grades hidden
      </span>
    );
  }
  return (
    <span className={`inline-flex shrink-0 items-center rounded-xl bg-surface-soft ${lg ? "px-3.5 py-2 text-[13px]" : "px-3 py-1.5 text-[12px]"} font-medium text-muted`}>
      No grades yet
    </span>
  );
}
