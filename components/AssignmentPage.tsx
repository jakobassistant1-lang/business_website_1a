"use client";

// The assignment-detail leaf (/assignment/[id]). The one place a student lands to
// actually DO an assignment: what it is, where it stands, an AI "how to approach"
// with concrete sub-steps, the Canvas brief, a best-effort rubric, and a jump out
// to Canvas. The AI plan and rubric are both fetched client-side and fail open —
// the page is fully useful without them, and neither blocks the page's SSR.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ymd, parseYmd, WEEKDAYS_FULL, MONTHS_SHORT } from "@/lib/calendarDates";
import { cleanCourse } from "@/lib/courseName";
import { toneSoft, type Tone } from "@/lib/tone";
import { TYPE_LABEL, type ItemType } from "@/lib/itemType";
import { EffortTag, EffortEditor, MarkDoneButton } from "@/components/calendar/parts";
import type { CanvasRubricCriterion } from "@/lib/canvas";
import DOMPurify, { type Config as PurifyConfig } from "dompurify";
import { htmlToText } from "@/lib/htmlText";

// --- Canvas brief sanitization (browser-only) -------------------------------
// The server hands us the RAW Canvas HTML (no DOM there, and jsdom on the server
// broke this route on Vercel). DOMPurify only works with a real `window` — with
// none it returns its input UNCHANGED — so sanitizing is done in a useEffect
// after mount, and until then the brief renders as escaped plain text.
const PURIFY_CONFIG: PurifyConfig = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ["target"],
  FORBID_TAGS: ["style", "iframe", "form", "input", "script"],
};

// Every outbound link in the brief opens in a new tab and can't reach back to
// our window. In-page anchors (href="#…") and bare <a> without href are left
// alone. The hook is registered once at module scope, never per render; the
// removeHook first keeps it single under HMR (DOMPurify's instance survives a
// module re-evaluation, this module's guard flag does not).
let hookInstalled = false;
function installPurifyHook() {
  if (hookInstalled) return;
  hookInstalled = true;
  DOMPurify.removeHook("afterSanitizeAttributes");
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName !== "A") return;
    const href = node.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  });
}

function sanitizeBrief(html: string): string {
  installPurifyHook();
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}

/** Relative, do-next voice for the due date — matches the rest of the app. */
function dueLabel(iso: string | null, todayYmd: string): string {
  if (!iso) return "No due date";
  const d = parseYmd(ymd(new Date(iso)));
  const days = Math.round((d.getTime() - parseYmd(todayYmd).getTime()) / 86_400_000);
  const date = `${WEEKDAYS_FULL[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  if (days < 0) return `Past due · ${date}`;
  if (days === 0) return `Due today · ${date}`;
  if (days === 1) return `Due tomorrow · ${date}`;
  return `Due ${date}`;
}

function submissionBadge(
  state: string | null,
  score: number | null,
  points: number | null,
  submittedAt: string | null,
  iso: string | null,
  todayYmd: string,
  manuallyDone = false
): { label: string; tone: Tone } {
  if (state === "graded") {
    const pts = score != null ? `${score}${points != null && points > 0 ? `/${points}` : ""} pts` : "";
    return { label: pts ? `Graded · ${pts}` : "Graded", tone: "success" };
  }
  // Treat a recorded submission time as submitted even if Canvas didn't sync a
  // workflow_state — keeps this badge consistent with the "Completed" sections.
  if (state === "submitted" || state === "pending_review" || submittedAt) return { label: "Submitted", tone: "success" };
  // The student's own checkoff (no Canvas submission): their word, labeled as such.
  if (manuallyDone) return { label: "Marked done by you", tone: "success" };
  // Not submitted — is it already late?
  const overdue = iso ? parseYmd(ymd(new Date(iso))).getTime() < parseYmd(todayYmd).getTime() : false;
  return overdue ? { label: "Not submitted — overdue", tone: "danger" } : { label: "Not submitted yet", tone: "warning" };
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
  description: string | null;
  submissionState: string | null;
  submittedAt: string | null;
  submissionScore: number | null;
  summary: string | null;
  manuallyDone?: boolean; // student's own checkoff (manualDoneAt) — see lib/assignmentStatus
  todayYmd: string;
  // Demo wiring (optional, additive): `demo` skips the live AI/rubric fetches so the
  // page renders purely from props; `onBack` overrides the router for in-demo back.
  demo?: boolean;
  onBack?: () => void;
}) {
  const { canvasId, name, courseName, type, dueAt, points, estimatedEffortHours, effortOverrideHours, htmlUrl, description, submissionState, submittedAt, submissionScore, summary, manuallyDone = false, todayYmd, demo, onBack } = props;
  const router = useRouter();

  // AI approach + steps, lazy-fetched. Seed the approach with the stored one-liner
  // (if any) so something useful shows instantly, then upgrade in place. The parent
  // keys this component by canvasId, so navigating to another assignment remounts
  // it — state never leaks between assignments.
  const [approach, setApproach] = useState<string | null>(summary);
  const [steps, setSteps] = useState<string[]>([]);
  const [loadingPlan, setLoadingPlan] = useState(!demo);
  const [rubric, setRubric] = useState<CanvasRubricCriterion[] | null>(null);

  // Sanitized brief HTML — null until DOMPurify has run in the browser. Never
  // set on the server; never fed the raw prop.
  const [safeHtml, setSafeHtml] = useState<string | null>(null);
  useEffect(() => {
    if (!description || !description.trim() || !DOMPurify.isSupported) {
      setSafeHtml(null);
      return;
    }
    setSafeHtml(sanitizeBrief(description));
  }, [description]);

  useEffect(() => {
    if (demo) return; // demo: render from the seeded summary; no live fetch
    let cancelled = false;
    setLoadingPlan(true);
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
  }, [canvasId, demo]);

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

  const badge = submissionBadge(submissionState, submissionScore, points, submittedAt, dueAt, todayYmd, manuallyDone);
  const hasPlan = Boolean(approach) || steps.length > 0;
  // Manual checkoff — hidden in demo and once Canvas itself confirms a submission.
  const canMarkDone = !demo && !(submittedAt || submissionState === "submitted" || submissionState === "pending_review" || submissionState === "graded");
  // Phones (#39): a thumb-zone action bar carries Open in Canvas + Mark as done.
  const hasActionBar = Boolean(htmlUrl) || canMarkDone;

  // "← Back" returns within the app when there's history, else falls back to the
  // dashboard (so a bookmarked / shared / refreshed deep link never dead-ends out).
  const goBack = () => {
    if (onBack) return onBack(); // demo: stay inside the demo shell
    return typeof window !== "undefined" && window.history.length > 1 ? router.back() : router.push("/dashboard");
  };

  return (
    <div className={`mx-auto max-w-3xl ${hasActionBar ? "max-md:pb-20" : ""}`}>
      <button onClick={goBack} className="max-md:tap max-md:-my-3 inline-flex items-center text-[14px] font-medium text-muted transition-colors hover:text-ink">
        ← Back
      </button>

      <p className="mt-4 text-[13px] font-semibold uppercase tracking-wider text-muted">
        {TYPE_LABEL[type]} · {cleanCourse(courseName)}
      </p>
      <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight text-ink">{name}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-2.5 text-[13.5px] font-medium">
        <span className="rounded-full bg-surface-soft px-3 py-1 text-ink">{dueLabel(dueAt, todayYmd)}</span>
        {points != null && points > 0 && <span className="rounded-full bg-surface-soft px-3 py-1 text-ink">{points} pts</span>}
        {demo ? (
          <EffortTag hours={estimatedEffortHours} className="rounded-full bg-surface-soft px-3 py-1" />
        ) : (
          <EffortEditor canvasId={canvasId} estimate={estimatedEffortHours ?? null} override={effortOverrideHours ?? null} />
        )}
        <span className={`rounded-full px-3 py-1 ${toneSoft[badge.tone]}`}>{badge.label}</span>
        {/* ONE MarkDoneButton (one piece of state). md+: it sits inline here
            (`contents`). Phones: the same element is pinned by fixed positioning
            into the slot the action bar below reserves for it — the offsets mirror
            the bar's geometry (bottom above the tab bar + the bar's py-2; right
            px-4; half width = (100vw − 2·16px padding − 10px gap) / 2). */}
        {canMarkDone && (
          <span
            className={`max-md:fixed max-md:bottom-[calc(56px+env(safe-area-inset-bottom)+0.5rem)] max-md:right-4 max-md:z-40 max-md:flex max-md:h-11 md:contents max-md:[&>button]:tap max-md:[&>button]:w-full max-md:[&>button]:rounded-lg max-md:[&>button]:text-[15px] ${
              htmlUrl ? "max-md:w-[calc(50%-21px)]" : "max-md:left-4"
            }`}
          >
            <MarkDoneButton canvasId={canvasId} done={manuallyDone} />
          </span>
        )}
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

      {/* Canvas brief (the assignment body). Before the browser has sanitized it
          (SSR + first paint) it renders as escaped plain text; once DOMPurify has
          run, the sanitized HTML takes over with basic prose styling. */}
      {description && description.trim() && (
        <section className="card mt-6 p-6">
          <h2 className="text-[19px] font-semibold text-ink">Assignment brief</h2>
          {safeHtml != null ? (
            // `brief` wrapper: Canvas HTML is arbitrary — images/embeds shrink to fit
            // everywhere; on phones wide tables and code scroll sideways instead of
            // widening the page (desktop table layout unchanged).
            <div className="brief [&_iframe]:max-w-full [&_img]:h-auto [&_img]:max-w-full max-md:[&_pre]:overflow-x-auto max-md:[&_table]:block max-md:[&_table]:max-w-full max-md:[&_table]:overflow-x-auto">
              <div
                className="mt-2 text-[15px] leading-relaxed text-ink [&_a]:text-accent [&_a]:underline [&_h1]:mt-3 [&_h1]:text-[17px] [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-[16px] [&_h2]:font-semibold [&_li]:mb-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: safeHtml }}
              />
            </div>
          ) : (
            <div className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-ink max-md:break-words">{htmlToText(description)}</div>
          )}
        </section>
      )}

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

      {htmlUrl && (
        <div className="mt-7 hidden md:block">
          <a href={htmlUrl} target="_blank" rel="noreferrer" className="btn-primary inline-flex items-center gap-1.5">
            Open in Canvas
            <ExternalIcon />
          </a>
        </div>
      )}

      {/* Phones: sticky thumb-zone actions, sitting just above the fixed tab bar
          (whose own pb-safe already covers the home-indicator inset). The Mark
          done half is a reserved slot — the single MarkDoneButton above is
          pinned into it (see the comment there). */}
      {hasActionBar && (
        <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 flex gap-2.5 border-t border-line bg-surface/95 px-4 py-2 backdrop-blur md:hidden">
          {htmlUrl && (
            <a href={htmlUrl} target="_blank" rel="noreferrer" className="btn-primary tap flex-1 gap-1.5">
              Open in Canvas
              <ExternalIcon />
            </a>
          )}
          {canMarkDone && <span className="h-11 flex-1" aria-hidden />}
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
