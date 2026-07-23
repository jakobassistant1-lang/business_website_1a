"use client";

// One class's full assignment list — opened from a Course overview card.
// Overdue / Upcoming / Completed sections; each row navigates to that item's
// detail leaf (/assignment/:id, or /study/:id for exams & quizzes).

import { useState } from "react";
import Link from "next/link";
import { ymd, parseYmd, WEEKDAYS_FULL, MONTHS_SHORT } from "@/lib/calendarDates";
import { cleanCourse } from "@/lib/courseName";
import { GradePill } from "@/components/GradePill";
import { GradeCalculator } from "@/components/GradeCalculator";
import type { CourseGrade } from "@/lib/courseGrade";
import type { GradeInput } from "@/lib/gradeCalc";
import type { CalendarItem } from "@/lib/calendarData";
import { itemHref, TYPE_LABEL } from "@/lib/itemType";
import { EffortTag, DoneCheck } from "@/components/calendar/parts";

function dueLabel(iso: string | null, todayYmd: string): string {
  if (!iso) return "No due date";
  const d = parseYmd(ymd(new Date(iso)));
  const days = Math.round((d.getTime() - parseYmd(todayYmd).getTime()) / 86_400_000);
  const date = `${WEEKDAYS_FULL[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  if (days === 0) return `Today · ${date}`;
  if (days === 1) return `Tomorrow · ${date}`;
  return date;
}

export function CoursePage({ courseName, grade, active, completed, rankedIds, todayYmd, demo = false }: { courseName: string; grade?: CourseGrade; active: CalendarItem[]; completed: CalendarItem[]; rankedIds: number[]; todayYmd: string; demo?: boolean }) {
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
  const [tab, setTab] = useState<"assignments" | "grades">("assignments");

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/dashboard" className="text-[14px] font-medium text-accent hover:underline">
        ← Dashboard
      </Link>
      <div className="mt-3 flex items-start justify-between gap-4">
        <h1 className="text-[28px] font-bold tracking-tight text-ink">{cleanCourse(courseName)}</h1>
        {grade && <GradePill grade={grade} size="lg" />}
      </div>
      <p className="mt-1 text-[15px] text-muted">
        {overdue.length > 0 && (
          <>
            <span className="font-medium text-muted">{overdue.length} overdue</span> ·{" "}
          </>
        )}
        {upcoming.length} upcoming · {completed.length} done
      </p>

      {hasGradeables && (
        <div role="tablist" aria-label="Course view" className="mt-5 inline-flex gap-1 rounded-lg border border-line-subtle bg-surface-soft p-1">
          {(["assignments", "grades"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium capitalize transition ${tab === t ? "bg-accent text-accent-on" : "text-muted hover:bg-surface"}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

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
  return (
    <Link href={itemHref(item.canvasId, item.type, item.status)} className="flex items-center gap-3 rounded-lg px-3 py-3.5 transition hover:bg-surface-soft/60">
      {!done ? (
        <DoneCheck canvasId={item.canvasId} disabled={demo} />
      ) : item.manuallyDone ? (
        <DoneCheck canvasId={item.canvasId} checked disabled={demo} />
      ) : (
        // Canvas-verified submission — done-ness isn't the student's claim, so no un-check.
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2 border-success/40 text-success" aria-hidden title="Submitted in Canvas">
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6.5 4.8 9 10 3.5" />
          </svg>
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[16px] ${done ? "text-muted line-through" : "font-medium text-ink"}`}>{item.name}</span>
        <span className="flex items-center gap-1.5 truncate text-[13px] text-muted">
          <span className="truncate">
            {TYPE_LABEL[item.type]}
            {item.pointsPossible != null && item.pointsPossible > 0 ? ` · ${item.pointsPossible} pts` : ""}
          </span>
          <EffortTag hours={item.estimatedEffortHours} className="text-[13px]" />
        </span>
      </span>
      <span className={`shrink-0 text-[14px] font-medium ${done ? "text-success" : "text-ink"}`}>{done ? "Done" : dueLabel(item.dueAt, todayYmd)}</span>
    </Link>
  );
}
