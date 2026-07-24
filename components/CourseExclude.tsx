"use client";

// Course exclusion UI (#60): the kebab menu on course cards, the "Excluded from
// your plan" row under the class grid, and the course-page banner/action. All
// call PATCH /api/course/exclude; the data chokepoint (lib/calendarData /
// lib/plan) does the rest, so every surface updates together on refresh.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cleanCourse } from "@/lib/courseName";

function EyeOffIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c7 0 10 7 10 7a17.4 17.4 0 0 1-2.1 3M6.6 6.6A17 17 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6M3 3l18 18" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

async function setExcluded(courseCanvasId: number, excluded: boolean): Promise<boolean> {
  try {
    const res = await fetch("/api/course/exclude", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseCanvasId, excluded }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The ⋯ menu on a course card. Lives inside the card <Link>, so every click
 *  stops propagation — opening the menu never navigates. */
export function CourseMenu({ courseCanvasId }: { courseCanvasId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const exclude = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await setExcluded(courseCanvasId, true);
    setBusy(false);
    setOpen(false);
    if (ok) router.refresh();
  };

  return (
    <span className="relative" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <button
        type="button"
        aria-label="Class options"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition hover:bg-surface-soft hover:text-ink"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} aria-hidden />
          <span className="absolute right-0 top-8 z-30 block w-60 rounded-lg border border-line bg-surface p-1 shadow-lg">
            <button
              type="button"
              onClick={exclude}
              disabled={busy}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13.5px] font-medium text-ink transition hover:bg-surface-soft"
            >
              <EyeOffIcon className="h-4 w-4 shrink-0 text-muted" />
              Exclude from my plan
            </button>
            <span className="block px-2.5 pb-1.5 pt-0.5 text-[11.5px] leading-snug text-muted">
              Hides its work from your plan and lists. You can undo this anytime.
            </span>
          </span>
        </>
      )}
    </span>
  );
}

/** The quiet dashed row under the class grid — the entire management UI for
 *  excluded classes. Invisible when nothing is excluded. */
export function ExcludedCoursesRow({ courses, demo = false }: { courses: { canvasId: number; name: string }[]; demo?: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  if (courses.length === 0) return null;

  const include = async (id: number) => {
    if (busyId != null) return;
    setBusyId(id);
    const ok = await setExcluded(id, false);
    setBusyId(null);
    if (ok) router.refresh();
  };

  return (
    <div className="mt-4 rounded-lg border border-dashed border-line px-4 py-2.5">
      {courses.map((c) => (
        <div key={c.canvasId} className="flex items-center justify-between gap-3 py-1">
          <p className="min-w-0 truncate text-[13.5px] text-muted">
            <EyeOffIcon className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />
            Excluded from your plan: <span className="text-ink">{cleanCourse(c.name)}</span>
          </p>
          {!demo && (
            <button
              type="button"
              onClick={() => include(c.canvasId)}
              disabled={busyId != null}
              className="shrink-0 text-[13.5px] font-medium text-accent hover:underline disabled:opacity-50"
            >
              {busyId === c.canvasId ? "Including…" : "Include again"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Course-page banner shown when this class is excluded. */
export function ExcludedBanner({ courseCanvasId }: { courseCanvasId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const include = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await setExcluded(courseCanvasId, false);
    setBusy(false);
    if (ok) router.refresh();
  };
  return (
    <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-dashed border-line bg-surface-soft px-4 py-3">
      <p className="min-w-0 text-[14px] text-muted">
        <EyeOffIcon className="mr-1.5 inline h-4 w-4 align-[-3px]" />
        This class is excluded from your plan — its work doesn&apos;t appear in your lists or schedule.
      </p>
      <button type="button" onClick={include} disabled={busy} className="shrink-0 text-[14px] font-medium text-accent hover:underline disabled:opacity-50">
        {busy ? "Including…" : "Include again"}
      </button>
    </div>
  );
}

/** Small, out-of-the-way exclude action for the course page header. */
export function ExcludeCourseAction({ courseCanvasId }: { courseCanvasId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const exclude = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await setExcluded(courseCanvasId, true);
    setBusy(false);
    if (ok) router.refresh();
  };
  return (
    <button
      type="button"
      onClick={exclude}
      disabled={busy}
      title="Hides this class's work from your plan and lists. Undo anytime."
      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-faint transition hover:text-muted disabled:opacity-50"
    >
      <EyeOffIcon className="h-3.5 w-3.5" />
      {busy ? "Excluding…" : "Exclude from my plan"}
    </button>
  );
}
