"use client";

// One class's full assignment list — opened from a card on the Classes page.
// Overdue / Upcoming / Completed sections; each row navigates to that item's
// detail leaf (/assignment/:id, or /study/:id for exams & quizzes).

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cleanCourse } from "@/lib/courseName";
import { GradePill } from "@/components/GradePill";
import { GradeCalculator } from "@/components/GradeCalculator";
import { DueLabel } from "@/components/DueLabel";
import type { CourseGrade } from "@/lib/courseGrade";
import type { GradeInput } from "@/lib/gradeCalc";
import type { CalendarItem } from "@/lib/calendarData";
import { itemHref, TYPE_LABEL } from "@/lib/itemType";
import { EffortTag, DoneCheck } from "@/components/calendar/parts";
import { ExcludeCourseAction, ExcludedBanner } from "@/components/CourseExclude";

export type ClassTab = "assignments" | "grades";
const TABS: { id: ClassTab; label: string }[] = [
  { id: "assignments", label: "Assignments" },
  { id: "grades", label: "Grades" },
];

/** True when "back" would land on a page of this app. `history.length > 1`
 *  alone can't tell (a new tab opened from an email has two entries), so also
 *  require an in-app origin: a same-origin referrer, or — because client-side
 *  navigation never updates `document.referrer` — a document first loaded at a
 *  different path than this one (we got here through an in-app link). */
function canGoBackInApp(): boolean {
  if (window.history.length <= 1) return false;
  try {
    if (document.referrer && new URL(document.referrer).origin === window.location.origin) return true;
  } catch {
    /* malformed referrer → fall through */
  }
  const nav = performance.getEntriesByType?.("navigation")[0];
  if (!nav) return false;
  try {
    return new URL(nav.name).pathname !== window.location.pathname;
  } catch {
    return false;
  }
}

export function CoursePage({ courseName, grade, active, completed, rankedIds, todayYmd, demo = false, courseCanvasId, excludedCourse = false, initialTab = "assignments", onBack }: { courseName: string; grade?: CourseGrade; active: CalendarItem[]; completed: CalendarItem[]; rankedIds: number[]; todayYmd: string; demo?: boolean; courseCanvasId?: number; excludedCourse?: boolean; initialTab?: ClassTab; onBack?: () => void }) {
  const router = useRouter();
  // Do-next ordering — by importance rank, never by due date.
  const rank = new Map(rankedIds.map((id, i) => [id, i] as const));
  const byRank = (a: CalendarItem, b: CalendarItem) => (rank.get(a.canvasId) ?? 1e9) - (rank.get(b.canvasId) ?? 1e9);
  const overdue = active.filter((it) => it.status === "overdue").sort(byRank);
  const upcoming = active.filter((it) => it.status === "normal").sort(byRank);
  const gradeItems: GradeInput[] = [...active, ...completed].map((it) => ({
    canvasId: it.canvasId,
    name: it.name,
    pointsPossible: it.pointsPossible ?? 0,
    score: it.score,
    groupId: it.groupId,
    groupName: it.groupName,
    groupWeight: it.groupWeight,
  }));
  const hasGradeables = gradeItems.some((i) => i.pointsPossible > 0);
  const [tab, setTab] = useState<ClassTab>(initialTab);

  // The active tab lives in the URL (`?tab=grades`) so a refresh or a shared link
  // keeps the place. replaceState: switching tabs isn't a history step.
  const selectTab = (t: ClassTab) => {
    setTab(t);
    if (demo) return; // the demo frame owns its own URL
    const url = new URL(window.location.href);
    if (t === "assignments") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  // Tablist keyboard model (WAI-ARIA tabs, automatic activation — the same as
  // StudyTools): Left/Right wrap, Home/End jump; focus AND selection move, and
  // only the selected tab is in the Tab order.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const last = TABS.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next == null) return;
    e.preventDefault();
    selectTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  // "← Back" (a stable label, server and client): to wherever the student came
  // from inside the app (Dashboard, Plan, Classes…), else the link's own href,
  // /courses — never out of the app. Mirrors AssignmentPage. Only the BEHAVIOUR
  // is decided after mount; the text never flips.
  const [inAppBack, setInAppBack] = useState(false);
  useEffect(() => setInAppBack(!demo && canGoBackInApp()), [demo]);
  const goBack = (e: MouseEvent) => {
    if (onBack) {
      e.preventDefault();
      onBack();
    } else if (inAppBack) {
      e.preventDefault();
      router.back();
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/courses" onClick={goBack} className="max-md:tap max-md:-my-3 inline-flex items-center text-[14px] font-medium text-accent hover:underline">
        ← Back
      </Link>
      {/* Phones: the grade pill sits under the (wrapping) title so it never clips. */}
      <div className="mt-3 flex items-start justify-between gap-4 max-md:flex-col max-md:gap-2">
        <h1 className="text-[28px] font-bold tracking-tight text-ink max-md:min-w-0 max-md:break-words">{cleanCourse(courseName)}</h1>
        {grade && <GradePill grade={grade} size="lg" />}
      </div>
      <p className="mt-1 text-[15px] text-muted">
        {overdue.length > 0 && (
          <>
            <span className="font-medium text-muted">{overdue.length} overdue</span> ·{" "}
          </>
        )}
        {upcoming.length} upcoming · {completed.length} done
        {!demo && courseCanvasId != null && !excludedCourse && (
          <span className="ml-3 inline-block align-baseline">
            <ExcludeCourseAction courseCanvasId={courseCanvasId} />
          </span>
        )}
      </p>

      {excludedCourse && courseCanvasId != null && <ExcludedBanner courseCanvasId={courseCanvasId} />}

      {hasGradeables && (
        <div role="tablist" aria-label="Class view" onKeyDown={onTabKey} className="mt-5 inline-flex gap-1 rounded-lg border border-line-subtle bg-surface-soft p-1">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`class-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="class-tabpanel"
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => selectTab(t.id)}
              className={`max-md:tap rounded-md px-3.5 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-soft max-md:px-5 max-md:text-[15px] ${tab === t.id ? "bg-accent text-accent-on" : "text-muted hover:bg-surface"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div {...(hasGradeables ? { role: "tabpanel", id: "class-tabpanel", "aria-labelledby": `class-tab-${tab}` } : {})}>
        {hasGradeables && tab === "grades" ? (
          <GradeCalculator items={gradeItems} official={grade} />
        ) : (
          <div className="mt-7 space-y-7">
            {overdue.length > 0 && <Section title="Overdue" items={overdue} todayYmd={todayYmd} danger demo={demo} />}
            <Section title="Upcoming" items={upcoming} todayYmd={todayYmd} empty="Nothing upcoming — you're clear." demo={demo} />
            {completed.length > 0 && <Section title="Completed" items={completed} todayYmd={todayYmd} done demo={demo} />}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  todayYmd,
  danger,
  done,
  empty,
  demo,
}: {
  title: string;
  items: CalendarItem[];
  todayYmd: string;
  danger?: boolean;
  done?: boolean;
  empty?: string;
  demo?: boolean;
}) {
  return (
    <section>
      <h2 className={`mb-2 text-[13px] font-semibold uppercase tracking-wider ${danger ? "text-danger" : "text-muted"}`}>
        {title} ({items.length})
      </h2>
      {items.length === 0 ? (
        <p className="card p-6 text-center text-[15px] text-muted">{empty ?? "Nothing here."}</p>
      ) : (
        <div className="card divide-y divide-line-subtle p-2">
          {items.map((it) => (
            <Row key={it.canvasId} item={it} todayYmd={todayYmd} done={done} demo={demo} />
          ))}
        </div>
      )}
    </section>
  );
}

function Row({ item, todayYmd, done, demo }: { item: CalendarItem; todayYmd: string; done?: boolean; demo?: boolean }) {
  // Stretched-link row (#141): the done circle is a SIBLING of the <Link> (never a
  // control inside a link), raised with `relative z-10`; the link's `after:`
  // overlay makes the rest of the row open the item.
  return (
    <div className="relative flex items-center gap-3 rounded-lg px-3 py-3.5 transition hover:bg-surface-soft/60 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-accent">
      {!done ? (
        <span className="relative z-10 flex shrink-0">
          <DoneCheck canvasId={item.canvasId} disabled={demo} />
        </span>
      ) : item.manuallyDone ? (
        <span className="relative z-10 flex shrink-0">
          <DoneCheck canvasId={item.canvasId} checked disabled={demo} />
        </span>
      ) : (
        // Canvas-verified submission — done-ness isn't the student's claim, so no un-check.
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2 border-success/40 text-success" aria-hidden title="Submitted in Canvas">
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6.5 4.8 9 10 3.5" />
          </svg>
        </span>
      )}
      <Link
        href={itemHref(item.canvasId, item.type, item.status)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className={`line-clamp-2 break-words text-[16px] ${done ? "text-muted line-through" : "font-medium text-ink"}`}>{item.name}</span>
          <span className="flex items-center gap-1.5 truncate text-[13px] text-muted">
            <span className="truncate">
              {TYPE_LABEL[item.type]}
              {item.pointsPossible != null && item.pointsPossible > 0 ? ` · ${item.pointsPossible} pts` : ""}
            </span>
            <EffortTag hours={item.estimatedEffortHours} className="text-[13px]" />
          </span>
        </span>
        {done ? (
          <span className="shrink-0 text-[14px] font-medium text-success">Done</span>
        ) : (
          // Phones: the compact "Wed 9/30" so the title keeps its room; md+: the
          // full "Wednesday, Sep 30". Both rendered, CSS picks (no first-paint swap).
          <span className="shrink-0 text-right text-[14px] font-medium text-ink">
            <DueLabel iso={item.dueAt} format="short" todayYmd={todayYmd} empty="No due date" className="md:hidden" />
            <DueLabel iso={item.dueAt} format="long-plain" todayYmd={todayYmd} empty="No due date" className="max-md:hidden" />
          </span>
        )}
      </Link>
    </div>
  );
}
