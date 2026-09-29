"use client";

// The assignment-detail leaf (/assignment/[id]). The one place a student lands to
// actually DO an assignment: what it is, where it stands, an AI "how to approach"
// with concrete sub-steps, then ALWAYS the Canvas instructions word-for-word
// (#145: the AI section stays first, the teacher's own words sit right under it),
// a best-effort rubric, and a jump out to Canvas. The AI plan and rubric are both
// fetched client-side and fail open — the page is fully useful without them, and
// neither blocks the page's SSR. The Canvas brief arrives ALREADY sanitized
// (`safeHtml`, from lib/sanitizeBrief on the server), so it renders formatted on
// first paint — no text-then-HTML swap. Every date is read in the student's
// Canvas zone (`timeZone`, lib/studentZone), so server and client render the same.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isPastDue } from "@/lib/dueLabel";
import { DueLabel } from "@/components/DueLabel";
import { DEFAULT_STUDENT_ZONE } from "@/lib/studentZone";
import { cleanCourse } from "@/lib/courseName";
import { toneSoft, type Tone } from "@/lib/tone";
import { TYPE_LABEL, type ItemType } from "@/lib/itemType";
import { EffortTag, EffortEditor, MarkDoneButton } from "@/components/calendar/parts";
import type { CanvasRubricCriterion } from "@/lib/canvas";
import type { DoneReason } from "@/lib/assignmentStatus";

/** The status chip. `doneReason` comes from the page, which decides "done" with THE
 *  shared rule (lib/assignmentStatus.assignmentDoneReason) — this component never
 *  re-derives it. `pastDue` is lib/dueLabel's isPastDue read in the student's zone
 *  like the header's DueLabel, so the chip and the "Past due · …" date agree. */
function submissionBadge(doneReason: DoneReason | null, score: number | null, points: number | null, pastDue: boolean): { label: string; tone: Tone } {
  switch (doneReason) {
    case "graded": {
      const pts = score != null ? `${score}${points != null && points > 0 ? `/${points}` : ""} pts` : "";
      return { label: pts ? `Graded · ${pts}` : "Graded", tone: "success" };
    }
    case "submitted":
      return { label: "Submitted", tone: "success" };
    case "manual": // the student's own checkoff (no Canvas submission): their word, labeled as such
      return { label: "Marked done by you", tone: "success" };
    case "date_passed":
      return { label: "Date passed", tone: "neutral" };
  }
  return pastDue ? { label: "Not submitted, past due", tone: "danger" } : { label: "Not submitted yet", tone: "warning" };
}

export function AssignmentPage(props: {
  canvasId: number;
  name: string;
  courseName: string;
  type: ItemType;
  dueAt: string | null;
  points: number | null;
  estimatedEffortHours?: number | null;
  effortOverrideHours?: number | null;
  htmlUrl: string | null;
  // The Canvas brief, ALREADY sanitized on the server (lib/sanitizeBrief). Never
  // pass raw Canvas HTML here. null = no brief.
  safeHtml: string | null;
  submissionState?: string | null; // kept for callers; "done" comes from `done`/`doneReason`
  submittedAt?: string | null; // kept for callers; "done" comes from `done`/`doneReason`
  submissionScore: number | null;
  summary: string | null;
  manuallyDone?: boolean; // student's own checkoff (manualDoneAt) — see lib/assignmentStatus
  /** THE done decision, made by the page with lib/assignmentStatus.isAssignmentDone. */
  done?: boolean;
  /** Why it counts as done (null/undefined = not done). */
  doneReason?: DoneReason | null;
  /** Today in the student's zone (lib/studentZone.todayInZone). */
  todayYmd: string;
  /** The student's Canvas zone (lib/studentZone.studentZone); every date here is read in it. */
  timeZone?: string;
  /** Canvas's unlock date (ISO) — passed ONLY while it is still in the future: the
   *  item isn't open yet, so there is no AI plan, just "Not open yet. Opens …". */
  opensAt?: string | null;
  // Demo wiring (optional, additive): `demo` skips the live AI/rubric fetches so the
  // page renders purely from props; `onBack` overrides the router for in-demo back.
  demo?: boolean;
  onBack?: () => void;
}) {
  const { canvasId, name, courseName, type, dueAt, points, estimatedEffortHours, effortOverrideHours, htmlUrl, safeHtml, submissionScore, summary, manuallyDone = false, todayYmd, opensAt = null, demo, onBack } = props;
  const zone = props.timeZone ?? DEFAULT_STUDENT_ZONE;
  const notOpenYet = Boolean(opensAt);
  const hasInstructions = Boolean(safeHtml && safeHtml.trim());
  const router = useRouter();

  // The student's own checkoff, owned HERE so the two Mark-as-done buttons (inline
  // at md+, the phone action bar) are one piece of state. Re-seeded when a
  // refresh brings a new server value.
  const [done, setDone] = useState(manuallyDone);
  useEffect(() => setDone(manuallyDone), [manuallyDone]);

  // AI approach + steps, lazy-fetched. Seed the approach with the stored one-liner
  // (if any) so something useful shows instantly, then upgrade in place. The parent
  // keys this component by canvasId, so navigating to another assignment remounts
  // it — state never leaks between assignments.
  const [approach, setApproach] = useState<string | null>(notOpenYet ? null : summary);
  const [steps, setSteps] = useState<string[]>([]);
  const [loadingPlan, setLoadingPlan] = useState(!demo && !notOpenYet);
  const [rubric, setRubric] = useState<CanvasRubricCriterion[] | null>(null);

  useEffect(() => {
    if (demo || notOpenYet) return; // demo: seeded summary only; not open yet: no plan to make
    let cancelled = false;
    setLoadingPlan(true);
    // The server reads the student's Canvas zone itself (lib/studentZone).
    fetch(`/api/assignment/approach?id=${canvasId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        if (typeof body.approach === "string" && body.approach.trim()) setApproach(body.approach);
        if (Array.isArray(body.steps)) setSteps(body.steps.filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingPlan(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canvasId, demo, notOpenYet]);

  // Rubric — live Canvas call, fetched here (not in SSR) so it never blocks render.
  useEffect(() => {
    if (demo) return; // demo: no live rubric fetch
    let cancelled = false;
    fetch(`/api/assignment/rubric?id=${canvasId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled && body && Array.isArray(body.rubric)) setRubric(body.rubric);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canvasId, demo]);

  const pastDue = isPastDue(dueAt, { todayYmd, timeZone: zone });
  // THE done decision comes from the caller (lib/assignmentStatus) — never re-derived here.
  const doneReason: DoneReason | null = props.done ? (props.doneReason ?? null) : null;
  const badge = submissionBadge(doneReason, submissionScore, points, pastDue);
  const hasPlan = Boolean(approach) || steps.length > 0;
  // Manual checkoff — hidden in demo and whenever the item is done for any reason
  // other than the student's own checkoff (which they can undo here).
  const canMarkDone = !demo && (doneReason === null || doneReason === "manual");
  // Phones (#39): a thumb-zone action bar carries Open in Canvas + Mark as done.
  const hasActionBar = Boolean(htmlUrl) || canMarkDone;

  // "Back" returns within the app when there's history, else falls back to the
  // dashboard (so a bookmarked / shared / refreshed deep link never dead-ends out).
  const goBack = () => {
    if (onBack) return onBack(); // demo: stay inside the demo shell
    return typeof window !== "undefined" && window.history.length > 1 ? router.back() : router.push("/dashboard");
  };

  return (
    <div className={`mx-auto max-w-3xl ${hasActionBar ? "max-md:pb-20" : ""}`}>
      <button onClick={goBack} className="max-md:tap max-md:-my-3 inline-flex items-center gap-1 text-[14px] font-medium text-muted transition-colors hover:text-ink">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back
      </button>

      <p className="mt-4 text-[14px] font-medium text-muted">
        {TYPE_LABEL[type]} · {cleanCourse(courseName)}
      </p>
      <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight text-ink">{name}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-2.5 text-[13.5px] font-medium">
        <DueLabel iso={dueAt} format="long" todayYmd={todayYmd} timeZone={zone} empty="No due date" className="rounded-full bg-surface-soft px-3 py-1 text-ink" />
        {points != null && points > 0 && <span className="rounded-full bg-surface-soft px-3 py-1 text-ink">{points} pts</span>}
        {demo ? (
          <EffortTag hours={estimatedEffortHours} className="rounded-full bg-surface-soft px-3 py-1" />
        ) : (
          <EffortEditor canvasId={canvasId} estimate={estimatedEffortHours ?? null} override={effortOverrideHours ?? null} />
        )}
        <span className={`rounded-full px-3 py-1 ${toneSoft[badge.tone]}`}>{badge.label}</span>
        {/* md+: Mark as done sits inline here. Phones get the second copy in the
            action bar below; both are controlled by `done`, so they agree. */}
        {canMarkDone && <MarkDoneButton canvasId={canvasId} done={done} onToggled={setDone} className="max-md:hidden" />}
      </div>

      {/* How to approach — the value add: turn a vague task into a first move. */}
      {(hasPlan || loadingPlan) && (
        <section className="card mt-7 p-6">
          <h2 className="flex items-center gap-2 text-[19px] font-semibold text-ink">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-accent" aria-hidden="true">
              <path d="M12 2l2.3 6.1L20.5 10l-6.2 1.9L12 18l-2.3-6.1L3.5 10l6.2-1.9z" />
            </svg>
            How to approach this
          </h2>
          {approach ? (
            <p className="mt-2 text-[16px] leading-relaxed text-ink">{approach}</p>
          ) : loadingPlan ? (
            <p className="mt-2 text-[15px] text-muted">Working out a plan…</p>
          ) : null}
          {steps.length > 0 && (
            <ol className="mt-4 space-y-2.5">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">{i + 1}</span>
                  <span className="pt-0.5 text-[15px] leading-relaxed text-ink">{s}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {/* Canvas instructions — ALWAYS rendered, directly under the AI section (#145):
          the teacher's words verbatim (sanitized on the server, formatted from the
          first paint), or one plain line saying why there are none. */}
      <section className="card mt-6 p-6" aria-labelledby="canvas-instructions">
        <h2 id="canvas-instructions" className="text-[19px] font-semibold text-ink">Canvas instructions</h2>
        {notOpenYet && (
          <p className="mt-2 text-[15px] leading-relaxed text-ink">
            Not open yet. Opens <DueLabel iso={opensAt} format="long-time" todayYmd={todayYmd} timeZone={zone} />.
          </p>
        )}
        {safeHtml && hasInstructions ? (
          /* `brief` wrapper: Canvas HTML is arbitrary — images/embeds shrink to fit
             everywhere; on phones wide tables and code scroll sideways instead of
             widening the page (desktop table layout unchanged). `relative
             overflow-hidden [contain:layout_paint]` is a backstop: nothing inside the
             brief can paint outside its own box, whatever styling slips through. */
          <div className="brief relative overflow-hidden [contain:layout_paint] [&_iframe]:max-w-full [&_img]:h-auto [&_img]:max-w-full max-md:[&_pre]:overflow-x-auto max-md:[&_table]:block max-md:[&_table]:max-w-full max-md:[&_table]:overflow-x-auto">
            <div
              className="mt-2 text-[15px] leading-relaxed text-ink [&_a]:text-accent [&_a]:underline [&_h1]:mt-3 [&_h1]:text-[17px] [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-[16px] [&_h2]:font-semibold [&_li]:mb-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          </div>
        ) : (
          !notOpenYet && <p className="mt-2 text-[15px] leading-relaxed text-muted">Your teacher hasn&rsquo;t added instructions in Canvas.</p>
        )}
        {/* md+: the way out to Canvas lives with the instructions. Phones get it in
            the thumb-zone action bar below. */}
        {htmlUrl && (
          <div className="mt-5 hidden md:block">
            <a href={htmlUrl} target="_blank" rel="noreferrer" className="btn-primary inline-flex items-center gap-1.5">
              Open in Canvas
              <ExternalIcon />
            </a>
          </div>
        )}
      </section>

      {/* Best-effort rubric — what it's graded on. */}
      {rubric && rubric.length > 0 && (
        <section className="card mt-6 p-6">
          <h2 className="text-[19px] font-semibold text-ink">What it&rsquo;s graded on</h2>
          <ul className="mt-2 divide-y divide-line-subtle">
            {rubric.map((c, i) => (
              <li key={i} className="flex items-start justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="block text-[15.5px] font-medium text-ink">{c.description}</span>
                  {c.longDescription && <span className="mt-0.5 block text-[14px] leading-relaxed text-muted">{c.longDescription}</span>}
                </span>
                {c.points > 0 && <span className="shrink-0 text-[14px] font-semibold text-muted">{c.points} pts</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Phones: sticky thumb-zone actions, sitting just above the fixed tab bar
          (whose own pb-safe already covers the home-indicator inset). A plain
          flex row: each button takes half (or all, when it's alone). */}
      {hasActionBar && (
        <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 flex gap-2 border-t border-line bg-surface/95 px-4 py-2 backdrop-blur md:hidden">
          {htmlUrl && (
            <a href={htmlUrl} target="_blank" rel="noreferrer" className="btn-primary max-md:tap min-w-0 flex-1 gap-1 whitespace-nowrap">
              Open in Canvas
              <ExternalIcon />
            </a>
          )}
          {canMarkDone && (
            <MarkDoneButton
              canvasId={canvasId}
              done={done}
              onToggled={setDone}
              className="max-md:tap max-md:min-w-0 max-md:flex-1 max-md:whitespace-nowrap max-md:rounded-lg max-md:px-4 max-md:text-sm"
            />
          )}
        </div>
      )}
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M7 17L17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
