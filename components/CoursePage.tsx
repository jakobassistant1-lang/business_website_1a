"use client";

// One class's full assignment list — opened from a Course overview card.
// Overdue / Upcoming / Completed sections; each row navigates to that item's
// detail leaf (/assignment/:id, or /study/:id for exams & quizzes).

import Link from "next/link";
import { ymd, parseYmd, WEEKDAYS_FULL, MONTHS_SHORT } from "@/lib/calendarDates";
import { cleanCourse } from "@/lib/courseName";
import type { CalendarItem } from "@/lib/calendarData";
import { itemHref, TYPE_LABEL } from "@/lib/itemType";

function dueLabel(iso: string | null, todayYmd: string): string {
  if (!iso) return "No due date";
  const d = parseYmd(ymd(new Date(iso)));
  const days = Math.round((d.getTime() - parseYmd(todayYmd).getTime()) / 86_400_000);
  const date = `${WEEKDAYS_FULL[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  if (days === 0) return `Today · ${date}`;
  if (days === 1) return `Tomorrow · ${date}`;
  return date;
}

export function CoursePage({ courseName, active, completed, rankedIds, todayYmd }: { courseName: string; active: CalendarItem[]; completed: CalendarItem[]; rankedIds: number[]; todayYmd: string }) {
  // Do-next ordering — by importance rank, never by due date.
  const rank = new Map(rankedIds.map((id, i) => [id, i] as const));
  const byRank = (a: CalendarItem, b: CalendarItem) => (rank.get(a.canvasId) ?? 1e9) - (rank.get(b.canvasId) ?? 1e9);
  const overdue = active.filter((it) => it.status === "overdue").sort(byRank);
  const upcoming = active.filter((it) => it.status === "normal").sort(byRank);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/dashboard" className="text-[14px] font-medium text-accent hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-3 text-[28px] font-bold tracking-tight text-ink">{cleanCourse(courseName)}</h1>
      <p className="mt-1 text-[15px] text-muted">
        {overdue.length > 0 && (
          <>
            <span className="font-medium text-danger">{overdue.length} overdue</span> ·{" "}
          </>
        )}
        {upcoming.length} upcoming · {completed.length} done
      </p>

      <div className="mt-7 space-y-7">
        {overdue.length > 0 && <Section title="Overdue" items={overdue} todayYmd={todayYmd} danger />}
        <Section title="Upcoming" items={upcoming} todayYmd={todayYmd} empty="Nothing upcoming — you're clear." />
        {completed.length > 0 && <Section title="Completed" items={completed} todayYmd={todayYmd} done />}
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
}: {
  title: string;
  items: CalendarItem[];
  todayYmd: string;
  danger?: boolean;
  done?: boolean;
  empty?: string;
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
            <Row key={it.canvasId} item={it} todayYmd={todayYmd} done={done} />
          ))}
        </div>
      )}
    </section>
  );
}

function Row({ item, todayYmd, done }: { item: CalendarItem; todayYmd: string; done?: boolean }) {
  return (
    <Link href={itemHref(item.canvasId, item.type, item.status)} className="flex items-center gap-3 rounded-lg px-3 py-3.5 transition hover:bg-surface-soft/60">
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[16px] ${done ? "text-muted line-through" : "font-medium text-ink"}`}>{item.name}</span>
        <span className="block truncate text-[13px] text-muted">
          {TYPE_LABEL[item.type]}
          {item.pointsPossible != null && item.pointsPossible > 0 ? ` · ${item.pointsPossible} pts` : ""}
        </span>
      </span>
      <span className={`shrink-0 text-[14px] font-medium ${done ? "text-success" : "text-ink"}`}>{done ? "Done" : dueLabel(item.dueAt, todayYmd)}</span>
    </Link>
  );
}
