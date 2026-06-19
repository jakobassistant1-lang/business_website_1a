"use client";

// The first-run DEMO experience. Renders the REAL app surfaces (Dashboard, Plan —
// List/Calendar/Timeline, Study, Courses) fed with mock data (lib/demoData) inside
// a self-contained shell — a slim "DEMO" bar, a thin accent ring around the framed
// app, a demo sidebar mirroring the real nav, and a driver.js spotlight that walks
// each page. Plan's three sub-views are walked as consecutive tour pages (the
// sidebar still shows one "Plan"). Nothing here touches the DB or Canvas (views get
// `demo` so they skip network side-effects, and in-view links are neutralized).
// Ends by marking the account onboarded and dropping the student on the real app.

import { useCallback, useEffect, useRef, useState } from "react";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { DashboardView } from "@/components/DashboardView";
import { PlanSurface } from "@/components/PlanSurface";
import { StudyView } from "@/components/StudyView";
import { CourseGrid } from "@/components/CourseGrid";
import { DemoStudyTools } from "@/components/DemoStudyTools";
import {
  DEMO_STEPS,
  DEMO_VIEW_ORDER,
  DEMO_VIEW_LABEL,
  WELCOME_STEP,
  FINALE_STEP,
  type DemoView,
  type TourStep,
} from "@/lib/tour/demoTour";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";

type Phase = "welcome" | "touring" | "exploring" | "finale";

interface Props {
  data: CalendarData;
  todayYmd: string;
  firstName: string;
  studyAssessments: CalendarItem[];
  studySessions: Record<number, { date: string; hours: number }[]>;
}

const LOGO = "M5 4h9l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4Z";
const CHECK = "M5 12.5l4 4 10-10";

// The sidebar mirrors the real app's nav (4 items). Plan's three tour pages all
// map to the one "plan" section. Icons match components/Sidebar.tsx.
const NAV: { section: string; label: string; icon: string; first: DemoView }[] = [
  { section: "dashboard", label: "Dashboard", icon: "M4 13h7V4H4v9Zm0 7h7v-5H4v5Zm9 0h7v-9h-7v9Zm0-16v5h7V4h-7Z", first: "dashboard" },
  { section: "plan", label: "Plan", icon: "M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01", first: "plan-list" },
  { section: "study", label: "Study", icon: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20M8 7h8", first: "study" },
  { section: "courses", label: "Courses", icon: "M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z", first: "courses" },
];
const sectionOf = (v: DemoView): string => (v.startsWith("plan") ? "plan" : v);

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function DemoExperience({ data, todayYmd, firstName, studyAssessments, studySessions }: Props) {
  const [view, setView] = useState<DemoView>("dashboard");
  const [phase, setPhase] = useState<Phase>("welcome");
  const [ending, setEnding] = useState(false);
  const driverRef = useRef<Driver | null>(null);
  // When jumping back a page, start that page's driver at its LAST step.
  const startAtLastRef = useRef(false);
  const sectionIdx = NAV.findIndex((n) => n.section === sectionOf(view));

  const destroyTour = useCallback(() => {
    driverRef.current?.destroy();
    driverRef.current = null;
  }, []);

  const advanceView = useCallback(() => {
    const idx = DEMO_VIEW_ORDER.indexOf(view);
    if (idx < DEMO_VIEW_ORDER.length - 1) setView(DEMO_VIEW_ORDER[idx + 1]);
    else setPhase("finale"); // past the last view → finale
  }, [view]);

  // Back from the first coachmark of a page → the previous page's last step.
  const goBack = useCallback(() => {
    const idx = DEMO_VIEW_ORDER.indexOf(view);
    if (idx > 0) {
      startAtLastRef.current = true;
      setView(DEMO_VIEW_ORDER[idx - 1]);
    }
  }, [view]);

  const endDemo = useCallback(async () => {
    if (ending) return;
    setEnding(true);
    destroyTour();
    await fetch("/api/onboarding/complete", { method: "POST" }).catch(() => {});
    // Real dashboard; ?welcome=1 triggers the one-time "connect Canvas" nudge.
    window.location.href = "/dashboard?welcome=1";
  }, [ending, destroyTour]);

  const startTour = useCallback(() => {
    setView("dashboard");
    setPhase("touring");
  }, []);

  const restartDemo = useCallback(() => {
    destroyTour();
    setView("dashboard");
    setPhase("touring");
  }, [destroyTour]);

  // Drive the guided spotlight for the current view while in the "touring" phase.
  useEffect(() => {
    if (phase !== "touring") {
      destroyTour();
      return;
    }
    let cancelled = false;
    const idx = DEMO_VIEW_ORDER.indexOf(view);
    const isFirstView = idx === 0;
    const isLastView = idx === DEMO_VIEW_ORDER.length - 1;
    const raw: TourStep[] = DEMO_STEPS[view];
    const reduce = prefersReducedMotion();

    const start = (tries = 0) => {
      if (cancelled) return;
      // Keep only steps whose anchor is on screen (centered steps always qualify).
      const present = raw.filter((s) => !s.selector || document.querySelector(s.selector));
      if (present.length === 0) {
        // Anchors may not have mounted yet; wait briefly, then move on rather than stall.
        if (tries < 15) {
          window.setTimeout(() => start(tries + 1), 60);
          return;
        }
        advanceView();
        return;
      }
      const nextLabel = isLastView ? "Finish" : DEMO_VIEW_LABEL[DEMO_VIEW_ORDER[idx + 1]];
      const steps = present.map((s, i) => {
        const last = i === present.length - 1;
        const first = i === 0;
        return {
          element: s.selector,
          popover: {
            title: s.title,
            description: s.body,
            ...(last
              ? {
                  nextBtnText: isLastView ? "Finish ✓" : `Next: ${nextLabel} →`,
                  onNextClick: () => {
                    destroyTour();
                    advanceView();
                  },
                }
              : {}),
            // First coachmark of a later page → Back crosses to the previous page.
            ...(first && !isFirstView
              ? {
                  onPrevClick: () => {
                    destroyTour();
                    goBack();
                  },
                }
              : {}),
          },
        };
      });
      destroyTour();
      const d = driver({
        popoverClass: "sp-demo-tour",
        overlayColor: "#1b1530", // deep violet-black scrim (brand-tinted, works in both themes)
        overlayOpacity: 0.62,
        stagePadding: 8,
        stageRadius: 10,
        animate: !reduce,
        smoothScroll: true,
        showProgress: present.length > 1,
        allowClose: true,
        nextBtnText: "Next →",
        prevBtnText: "← Back",
        doneBtnText: "Finish ✓",
        progressText: "{{current}} of {{total}}",
        onCloseClick: () => {
          destroyTour();
          setPhase("exploring"); // X → free-explore mode
        },
        onPopoverRender: (popover, { state }) => {
          // driver disables "Back" on a page's first step; re-enable it on later
          // pages so Back can cross to the previous page (handled by onPrevClick).
          if (!isFirstView && state.activeIndex === 0 && popover.previousButton) {
            popover.previousButton.disabled = false;
            popover.previousButton.classList.remove("driver-popover-btn-disabled");
          }
        },
        steps,
      });
      driverRef.current = d;
      d.drive(startAtLastRef.current ? steps.length - 1 : 0);
      startAtLastRef.current = false;
      // Recompute the spotlight once layout settles — a heavy view (the calendar
      // grid) can shift after first paint, which would leave the highlight stale.
      if (!reduce) {
        requestAnimationFrame(() => driverRef.current?.refresh());
        window.setTimeout(() => {
          if (!cancelled) driverRef.current?.refresh();
        }, 250);
      }
    };
    start();
    return () => {
      cancelled = true;
    };
    // Keyed on [view, phase] only: advanceView/goBack change solely with `view`
    // (already a dep, so the driver is rebuilt with the current closures each
    // view) and destroyTour is stable — re-adding them would re-run on the same
    // triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, phase]);

  // Action-gate the Study step: answering the demo question advances the tour
  // (the "do it, don't watch it" move). Bound only while on that step; the
  // popover's Next button still works as a fallback. DemoStudyTools fires the
  // event on the student's first pick.
  useEffect(() => {
    if (phase !== "touring" || view !== "study") return;
    const onAnswered = () => {
      destroyTour();
      advanceView();
    };
    window.addEventListener("sp:demo-answered", onAnswered);
    return () => window.removeEventListener("sp:demo-answered", onAnswered);
  }, [phase, view, destroyTour, advanceView]);

  // Tear the tour down if the component unmounts mid-demo.
  useEffect(() => () => destroyTour(), [destroyTour]);

  // Block any in-view navigation so a link can't bounce the student out of the demo.
  const neutralizeNav = (e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (anchor) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const navClass = (active: boolean) =>
    `flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      active ? "bg-accent text-accent-on" : "text-gray-300 hover:bg-gray-800 hover:text-white"
    }`;

  return (
    <>
      {/* Slim demo bar — fixed above the tour overlay so Exit/Replay always work. */}
      <header className="fixed inset-x-0 top-0 z-[100000] flex h-11 items-center justify-between gap-4 bg-accent px-3 text-accent-on sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider">Demo</span>
          <span className="hidden truncate text-xs font-medium text-accent-on/90 sm:inline">
            Sample data — nothing here is real yet
          </span>
        </div>

        {phase === "touring" && (
          <div className="hidden flex-1 items-center justify-center gap-1.5 sm:flex" aria-hidden>
            {NAV.map((n, i) => (
              <span
                key={n.section}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ease-out motion-reduce:transition-none ${
                  i === sectionIdx
                    ? "w-5 bg-accent-on"
                    : i < sectionIdx
                      ? "w-1.5 bg-accent-on/70"
                      : "w-1.5 bg-accent-on/30"
                }`}
              />
            ))}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1">
          {phase !== "welcome" && phase !== "finale" && (
            <button
              type="button"
              onClick={restartDemo}
              className="demo-control rounded-md px-2.5 py-1 text-xs font-semibold text-accent-on/90 transition-colors hover:bg-white/15"
            >
              ↻ Replay
            </button>
          )}
          <button
            type="button"
            onClick={endDemo}
            disabled={ending}
            className="demo-control rounded-md px-2.5 py-1 text-xs font-semibold text-accent-on transition-colors hover:bg-white/15 disabled:opacity-60"
          >
            Exit demo →
          </button>
        </div>
      </header>

      {/* The framed app — a thin accent ring on a soft violet wash, below the bar. */}
      <div className="fixed inset-x-0 bottom-0 top-11 z-0 bg-[rgb(var(--accent)/0.06)] p-3 sm:p-4">
        <div className="flex h-full overflow-hidden rounded-2xl bg-canvas shadow-[var(--shadow-demo)] ring-1 ring-accent/30">
          {/* Demo sidebar — mirrors the real nav; switches the on-screen view, with
              quiet tour progress (sections before the current one get a check). */}
          <aside className="flex w-64 shrink-0 flex-col bg-sidebar px-4 py-6">
            <div className="mb-6 flex items-center gap-3 px-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-on shadow-md">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d={LOGO} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <path d="M9 12.5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="text-lg font-bold tracking-tight text-white">StudyPlan</span>
            </div>
            <nav className="flex flex-col gap-1">
              {NAV.map((item, i) => {
                const active = sectionOf(view) === item.section;
                const done = phase === "touring" && i < sectionIdx;
                return (
                  <button key={item.section} type="button" onClick={() => setView(item.first)} className={navClass(active)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      {done ? (
                        <path d={CHECK} stroke="rgb(var(--success))" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      ) : (
                        <path d={item.icon} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      )}
                    </svg>
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <p className="mt-auto px-2 text-xs font-medium text-gray-500">Demo mode · sample data</p>
          </aside>

          {/* The real surfaces, mock-fed; in-view links neutralized. Plan's three
              sub-views are separate tour pages (remounted via key so the right one
              shows). */}
          <main onClickCapture={neutralizeNav} className="min-w-0 flex-1 overflow-auto px-6 py-8 lg:px-10 lg:py-10">
            {view === "dashboard" && <DashboardView data={data} todayYmd={todayYmd} firstName={firstName} demo />}
            {view === "plan-list" && <PlanSurface key="pl" data={data} todayYmd={todayYmd} demo initialView="list" />}
            {view === "plan-calendar" && <PlanSurface key="pc" data={data} todayYmd={todayYmd} demo initialView="calendar" />}
            {view === "plan-timeline" && <PlanSurface key="pt" data={data} todayYmd={todayYmd} demo initialView="timeline" />}
            {view === "study" && (
              <>
                <StudyView connected assessments={studyAssessments} sessions={studySessions} />
                <DemoStudyTools />
              </>
            )}
            {view === "courses" && (
              <div className="mx-auto max-w-7xl">
                <h1 className="text-[28px] font-bold tracking-tight text-ink">Courses</h1>
                <p className="mt-1 text-[15px] text-muted">Your classes at a glance — open one for its full assignment list.</p>
                <div className="mt-7">
                  <CourseGrid data={data} todayYmd={todayYmd} />
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Welcome fork — opt-in start beats an auto/timed tour. */}
      {phase === "welcome" && (
        <div className="fixed inset-0 z-[100002] flex items-center justify-center bg-ink/45 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-7 text-center shadow-[var(--shadow-demo)]">
            <p className="text-xl font-bold tracking-tight text-ink">{WELCOME_STEP.title}</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{WELCOME_STEP.body}</p>
            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => setPhase("exploring")}
                className="demo-control rounded-lg border border-line px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-accent-soft/50"
              >
                Explore on my own
              </button>
              <button type="button" onClick={startTour} autoFocus className="demo-control btn-primary">
                Take the 30-sec tour →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Free-explore bar (welcome → explore, or after closing a coachmark). */}
      {phase === "exploring" && (
        <div className="fixed bottom-5 left-1/2 z-[100001] flex -translate-x-1/2 items-center gap-4 rounded-full bg-ink px-5 py-2.5 text-sm text-white shadow-[var(--shadow-demo)]">
          <span className="font-medium">Exploring the demo — click around any page.</span>
          <button type="button" onClick={() => setPhase("touring")} className="demo-control font-semibold underline">
            Take the tour
          </button>
        </div>
      )}

      {/* Finale — celebrate, then hand off to the real app + Connect Canvas. */}
      {phase === "finale" && (
        <div className="fixed inset-0 z-[100002] flex items-center justify-center bg-ink/55 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-7 text-center shadow-[var(--shadow-demo)]">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-soft">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path className="sp-check-draw" d={CHECK} stroke="rgb(var(--success))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-xl font-bold tracking-tight text-ink">{FINALE_STEP.title}</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{FINALE_STEP.body}</p>
            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={restartDemo}
                className="demo-control rounded-lg border border-line px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-accent-soft/50"
              >
                ↻ Replay tour
              </button>
              <button type="button" onClick={endDemo} disabled={ending} autoFocus className="demo-control btn-primary">
                {ending ? "Loading…" : "Connect Canvas →"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
