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
import { AssignmentPage } from "@/components/AssignmentPage";
import { CoursePage } from "@/components/CoursePage";
import { NavIcon } from "@/components/NavIcon";
import { TAB_ITEMS } from "@/components/navItems";
import { cleanCourse } from "@/lib/courseName";
import { TYPE_LABEL } from "@/lib/itemType";
import {
  DEMO_STEPS,
  DEMO_VIEW_ORDER,
  DEMO_VIEW_LABEL,
  WELCOME_STEP,
  FINALE_STEP,
  placementFor,
  selectorFor,
  isAnchorShown,
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

// Phone shell (#39): below `md` the demo frame swaps its sidebar for the SAME
// four tabs as the real MobileTabBar (TAB_ITEMS — one nav list, can't drift).
// Each tab maps to the demo view it opens; taps drive the demo's own router
// (setView), never the real Next router.
const TAB_VIEW: Record<string, DemoView> = {
  "/dashboard": "dashboard",
  "/plan": "plan-list",
  "/study": "study",
  "/courses": "courses",
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function DemoExperience({ data, todayYmd, firstName, studyAssessments, studySessions }: Props) {
  const [view, setView] = useState<DemoView>("dashboard");
  const [phase, setPhase] = useState<Phase>("welcome");
  const [ending, setEnding] = useState(false);
  // Explore-mode deep view (assignment / per-test study / course detail) opened by
  // clicking an in-app link; null = show the current surface. See the demo router.
  const [detail, setDetail] = useState<{ kind: "assignment" | "study" | "course"; id: number } | null>(null);
  const driverRef = useRef<Driver | null>(null);
  // When jumping back a page, start that page's driver at its LAST step.
  const startAtLastRef = useRef(false);
  // The demo's real scroll container is <main> (overflow-auto), NOT the window —
  // driver.js measures/scrolls the window, so we drive the scroll ourselves.
  const mainRef = useRef<HTMLElement | null>(null);
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
    // The server decides the next stop: with billing on, a new student goes to
    // the card step (/welcome/card) before the app; otherwise straight in (#118).
    const body = await fetch("/api/onboarding/complete", { method: "POST" }).then((r) => r.json()).catch(() => null);
    window.location.href = body?.next ?? "/dashboard?welcome=1";
  }, [ending, destroyTour]);

  const startTour = useCallback(() => {
    setDetail(null);
    setView("dashboard");
    setPhase("touring");
  }, []);

  const restartDemo = useCallback(() => {
    destroyTour();
    setDetail(null);
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

    // Re-measure the spotlight only once the anchor actually has a laid-out box.
    // Plan/Calendar/Timeline remount heavy children (Gantt, week grid) that size
    // up AFTER first paint, so a fixed-timeout refresh can measure a 0-height box.
    // Poll a few animation frames until the element has nonzero size, then refresh.
    // Runs even under reduced motion (correctness, not animation).
    const settleThenRefresh = (el: HTMLElement | null, tries = 0) => {
      if (cancelled) return;
      const ready = !el || (el.offsetWidth > 0 && el.offsetHeight > 0);
      if (ready || tries >= 10) {
        driverRef.current?.refresh();
        return;
      }
      requestAnimationFrame(() => settleThenRefresh(el, tries + 1));
    };

    const start = (tries = 0) => {
      if (cancelled) return;
      // Phone-width viewport → phone anchors (selectorFor) and beside-the-anchor
      // popovers go below it (placementFor). Read once per tour page.
      const viewportWidth = window.innerWidth;
      // Resolve each step's anchor to the first RENDERED match — a plain
      // querySelector can return a CSS-hidden twin (e.g. a desktop-only view on
      // a phone). Keep only steps with a shown anchor (centered steps always qualify).
      const present = raw
        .map((s) => {
          const sel = selectorFor(s, viewportWidth);
          const anchor = sel ? (Array.from(document.querySelectorAll<HTMLElement>(sel)).find(isAnchorShown) ?? null) : null;
          return { s, sel, anchor };
        })
        .filter((r) => !r.sel || r.anchor);
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
      const steps = present.map(({ s, sel, anchor }, i) => {
        const last = i === present.length - 1;
        const first = i === 0;
        const place = placementFor(s, viewportWidth);
        return {
          // Re-resolved lazily when driver reaches the step (the node may have
          // re-rendered since start); falls back to the one found above.
          element: sel && anchor ? () => Array.from(document.querySelectorAll<HTMLElement>(sel)).find(isAnchorShown) ?? anchor : undefined,
          popover: {
            title: s.title,
            description: s.body,
            ...(place.side ? { side: place.side } : {}),
            ...(place.align ? { align: place.align } : {}),
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
        // We own the scroll (scrollIntoView the anchor inside <main> before
        // driving). Letting driver smooth-scroll the WINDOW races our scroll and
        // threw the spotlight out of frame on Back. Keep it off.
        smoothScroll: false,
        // Big anchors (whole Focus card / Gantt) otherwise become a giant clickable
        // cutout; highlight them, don't make them interactive.
        disableActiveInteraction: true,
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
          // A clear, always-present escape on EVERY coachmark: leave the guided
          // steps and explore the demo freely (mirrors the demo-bar button + the ✕,
          // so the option is obvious right where the student is reading).
          if (!popover.wrapper.querySelector(".sp-demo-explore")) {
            const skip = document.createElement("button");
            skip.type = "button";
            skip.className = "sp-demo-explore";
            skip.textContent = "Skip — explore on my own →";
            skip.addEventListener("click", () => {
              destroyTour();
              setPhase("exploring");
            });
            popover.wrapper.appendChild(skip);
          }
        },
        steps,
      });
      driverRef.current = d;
      const startIdx = startAtLastRef.current ? steps.length - 1 : 0;
      startAtLastRef.current = false;

      // Own the <main> scroll: reset the carried-over scrollTop, then bring the
      // target anchor into view INSIDE <main> before driving. driver.js measures
      // the window, so without this a stale main.scrollTop left the anchor — and
      // the cutout — off where driver thought it was. Fixes Back (which uniquely
      // drives the previous page's LAST/bottom step) and Next alike.
      const startAnchor = present[startIdx]?.anchor ?? null;
      const main = mainRef.current;
      if (main) {
        main.scrollTop = 0;
        startAnchor?.scrollIntoView({ block: startIdx === steps.length - 1 ? "center" : "nearest" });
      }

      d.drive(startIdx);

      // Re-measure once layout settles (heavy remounts size up after first paint).
      // Always runs at least once — under reduced motion we skip the ANIMATION
      // (animate:false above), not the correctness re-measure.
      settleThenRefresh(startAnchor);
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

  // Demo router: every in-view link is intercepted (so nothing ever navigates the
  // browser out of the demo). In EXPLORE mode, known in-app routes open the matching
  // deep view inline, rendered from the dummy data — clicking an assignment, a quiz/
  // exam, or a course "just works". During the guided tour (and welcome/finale) the
  // links stay inert, so the walkthrough flow is unchanged.
  const onMainClick = useCallback(
    (e: React.MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return; // let buttons (e.g. the practice question) work normally
      e.preventDefault();
      e.stopPropagation();
      if (phase !== "exploring") return;
      const href = anchor.getAttribute("href") ?? "";
      let m: RegExpMatchArray | null;
      if ((m = href.match(/^\/assignment\/(\d+)/))) setDetail({ kind: "assignment", id: Number(m[1]) });
      else if ((m = href.match(/^\/study\/(\d+)/))) setDetail({ kind: "study", id: Number(m[1]) });
      else if ((m = href.match(/^\/class\/(\d+)/))) setDetail({ kind: "course", id: Number(m[1]) });
      else if (href.startsWith("/dashboard")) {
        setDetail(null);
        setView("dashboard");
      }
      // Any other internal route (a surface-level link) → use the sidebar to switch;
      // external links are simply blocked (already prevented above).
    },
    [phase]
  );

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
          {phase === "touring" && (
            <button
              type="button"
              onClick={() => {
                destroyTour();
                setPhase("exploring");
              }}
              className="demo-control group rounded-md text-xs font-semibold text-accent-on max-md:tap max-md:inline-flex max-md:items-center max-md:justify-center"
            >
              {/* The visible pill stays compact (same box as before on desktop);
                  on phones .tap widens only the hit area around it. */}
              <span className="block rounded-md bg-white/15 px-2.5 py-1 transition-colors group-hover:bg-white/25">
                <span className="sm:hidden">Explore</span>
                <span className="hidden sm:inline">Explore on my own</span>
              </span>
            </button>
          )}
          {phase !== "welcome" && phase !== "finale" && (
            <button
              type="button"
              onClick={restartDemo}
              className="demo-control group rounded-md text-xs font-semibold text-accent-on/90 max-md:tap max-md:inline-flex max-md:items-center max-md:justify-center"
            >
              <span className="block rounded-md px-2.5 py-1 transition-colors group-hover:bg-white/15">↻ Replay</span>
            </button>
          )}
          <button
            type="button"
            onClick={endDemo}
            disabled={ending}
            className="demo-control group rounded-md text-xs font-semibold text-accent-on disabled:opacity-60 max-md:tap max-md:inline-flex max-md:items-center max-md:justify-center"
          >
            <span className="block rounded-md px-2.5 py-1 transition-colors group-hover:bg-white/15">Exit demo →</span>
          </button>
        </div>
      </header>

      {/* The framed app — a thin accent ring on a soft violet wash, below the bar. */}
      {/* Phones: the frame's bottom padding clears the home indicator, since the
          frame-local tab bar sits at its foot (like the real fixed MobileTabBar). */}
      <div className="fixed inset-x-0 bottom-0 top-11 z-0 bg-[rgb(var(--accent)/0.06)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
        <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-canvas shadow-[var(--shadow-demo)] ring-1 ring-accent/30 md:flex-row">
          {/* Demo sidebar — mirrors the real nav; switches the on-screen view, with
              quiet tour progress (sections before the current one get a check). */}
          <aside className="hidden w-64 shrink-0 flex-col bg-sidebar px-4 py-6 md:flex">
            <div className="mb-6 flex items-center gap-3 px-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-on shadow-md">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d={LOGO} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <path d="M9 12.5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="text-lg font-bold tracking-tight text-white">Navo</span>
            </div>
            <nav className="flex flex-col gap-1">
              {NAV.map((item, i) => {
                const active = sectionOf(view) === item.section;
                const done = phase === "touring" && i < sectionIdx;
                return (
                  <button key={item.section} type="button" onClick={() => { setDetail(null); setView(item.first); }} className={navClass(active)}>
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
          <main ref={mainRef} onClickCapture={onMainClick} className="min-w-0 flex-1 overflow-auto px-6 py-8 lg:px-10 lg:py-10 max-md:min-h-0 max-md:overflow-x-hidden max-md:px-4 max-md:py-5">
            {detail ? (
              <DemoDetail detail={detail} data={data} todayYmd={todayYmd} onBack={() => setDetail(null)} />
            ) : (
              <>
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
                      <CourseGrid data={data} todayYmd={todayYmd} demo />
                    </div>
                  </div>
                )}
              </>
            )}
          </main>

          {/* Phone tab bar, frame-local: the real MobileTabBar's four tabs
              (TAB_ITEMS), driving the demo router — same look, no navigation. */}
          <nav aria-label="Demo sections" className="shrink-0 border-t border-line bg-surface md:hidden">
            <ul className="flex h-14">
              {TAB_ITEMS.map((item) => {
                const target = TAB_VIEW[item.href];
                const isActive = !!target && sectionOf(view) === sectionOf(target);
                return (
                  <li key={item.href} className="min-w-0 flex-1">
                    <button
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => {
                        if (!target) return;
                        setDetail(null);
                        setView(target);
                      }}
                      className={`tap flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium leading-none transition-colors ${
                        isActive ? "text-accent" : "text-muted"
                      }`}
                    >
                      <NavIcon name={item.icon} size={22} />
                      <span>{item.tabLabel}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
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
        <div className="fixed bottom-5 left-1/2 z-[100001] flex -translate-x-1/2 items-center gap-4 rounded-full bg-ink px-5 py-2.5 text-sm text-white shadow-[var(--shadow-demo)] max-md:bottom-[calc(56px+max(0.75rem,env(safe-area-inset-bottom))+0.75rem)] max-md:w-max max-md:max-w-[calc(100vw-2rem)] max-md:gap-3 max-md:py-1 max-md:pl-4 max-md:pr-2 max-md:text-[13px]">
          <span className="font-medium max-md:min-w-0 max-md:truncate">
            <span className="md:hidden">Exploring the demo</span>
            <span className="max-md:hidden">Exploring the demo — click around any page.</span>
          </span>
          <button type="button" onClick={() => { setDetail(null); setPhase("touring"); }} className="demo-control font-semibold underline max-md:tap max-md:inline-flex max-md:shrink-0 max-md:items-center max-md:justify-center max-md:px-2">
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
            <button
              type="button"
              onClick={() => setPhase("exploring")}
              className="demo-control mx-auto mt-3 block text-sm font-semibold text-muted underline-offset-2 transition-colors hover:text-accent hover:underline"
            >
              Or explore the demo on my own
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Explore-mode deep views (rendered inline from the dummy data) ───────────────
// The demo router (onMainClick) sets `detail`; these render the matching real leaf
// with mock props so "click an assignment / quiz / course" works without a backend.
function DemoDetail({
  detail,
  data,
  todayYmd,
  onBack,
}: {
  detail: { kind: "assignment" | "study" | "course"; id: number };
  data: CalendarData;
  todayYmd: string;
  onBack: () => void;
}) {
  if (detail.kind === "course") {
    const active = data.items.filter((it) => it.courseCanvasId === detail.id);
    const completed = data.completed.filter((it) => it.courseCanvasId === detail.id);
    const courseName = [...active, ...completed][0]?.courseName ?? "Course";
    const grade = data.courses.find((c) => c.canvasId === detail.id)?.grade;
    return (
      <CoursePage
        courseName={courseName}
        grade={grade}
        active={active}
        completed={completed}
        rankedIds={data.ranked.map((r) => r.canvasId)}
        todayYmd={todayYmd}
        demo
      />
    );
  }

  const item = [...data.items, ...data.completed].find((it) => it.canvasId === detail.id);
  if (!item) {
    return (
      <div className="mx-auto max-w-3xl">
        <button onClick={onBack} className="text-[14px] font-medium text-muted transition-colors hover:text-ink">← Back</button>
        <p className="mt-6 text-[15px] text-muted">That item isn&rsquo;t part of the demo data.</p>
      </div>
    );
  }

  if (detail.kind === "study") return <DemoStudyDetail item={item} onBack={onBack} />;

  return (
    <AssignmentPage
      demo
      onBack={onBack}
      canvasId={item.canvasId}
      name={item.name}
      courseName={item.courseName}
      type={item.type}
      dueAt={item.dueAt}
      points={item.pointsPossible}
      estimatedEffortHours={item.estimatedEffortHours}
      htmlUrl={null}
      description={null}
      submissionState={item.status === "done" ? "submitted" : null}
      submittedAt={null}
      submissionScore={null}
      summary={item.summary}
      todayYmd={todayYmd}
    />
  );
}

// The per-test study page (exam/quiz) for the demo — the test header + the static
// DemoStudyTools preview (guide + practice question). The real per-test tools need
// an AI/Canvas round-trip, so the demo shows this faithful sample instead.
function DemoStudyDetail({ item, onBack }: { item: CalendarItem; onBack: () => void }) {
  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={onBack} className="text-[14px] font-medium text-muted transition-colors hover:text-ink">← Back</button>
      <p className="mt-4 text-[13px] font-semibold uppercase tracking-wider text-muted">
        {TYPE_LABEL[item.type]} · {cleanCourse(item.courseName)}
      </p>
      <h1 className="mt-1 text-[28px] font-bold tracking-tight text-ink">{item.name}</h1>
      <p className="mt-2 text-[15px] text-muted">A sample of the study guide and practice questions Navo auto-builds from each test&rsquo;s Canvas notes &amp; readings.</p>
      <DemoStudyTools />
    </div>
  );
}
