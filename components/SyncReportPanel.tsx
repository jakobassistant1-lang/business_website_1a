import { LocalRelativeTime } from "@/components/LocalRelativeTime";
import { toneSoft, type Tone } from "@/lib/tone";
import {
  courseLine,
  runSummary,
  skippedNonStudentText,
  type SyncReport,
  type SyncReportReason,
} from "@/lib/syncReport";

/** Inert reasons (fix themselves next run) stay neutral; the rest get the calm
 *  violet-grey warning tone — never red for a single class. */
const REASON_TONE: Record<SyncReportReason, Tone> = {
  out_of_time: "neutral",
  throttled: "neutral",
  unreachable: "warning",
  invalid_token: "warning",
  insufficient_scope: "warning",
  restricted: "warning",
  error: "warning",
};

/**
 * "Last sync" card on /connections (#132): when the last Canvas sync ran, which
 * classes it refreshed (with assignment counts) and a plain-English reason for any
 * it couldn't. Reads the persisted CanvasCredential.lastSyncReport, so it survives
 * a reload. Server component; only the relative time is client-rendered (viewer's clock).
 */
export function SyncReportPanel({ report }: { report: SyncReport }) {
  const skipped = skippedNonStudentText(report.skippedNonStudent);
  const run = runSummary(report);
  return (
    <div className="card mt-4 max-w-xl p-5 sm:p-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink">Last sync</span>
        <span className="min-w-0 truncate text-[13px] text-muted">
          <LocalRelativeTime iso={report.at} /> · {report.mode === "quick" ? "quick refresh" : "full sync"}
        </span>
      </div>

      {run && <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${toneSoft[REASON_TONE[run.reason]]}`}>{run.text}</p>}

      {report.courses.length > 0 ? (
        <ul className="divide-y divide-line text-sm">
          {report.courses.map((c) => (
            <li key={c.canvasId} className="flex items-center justify-between gap-3 py-2 max-md:min-h-11">
              <span className="min-w-0 flex-1 truncate text-ink">{c.name}</span>
              {c.ok ? (
                <span className="shrink-0 text-muted">{courseLine(c)}</span>
              ) : (
                <span className={`max-w-[60%] rounded-md px-2 py-0.5 text-right text-xs ${toneSoft[REASON_TONE[c.reason ?? "error"]]}`}>
                  {courseLine(c)}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !run && <p className="text-sm text-muted">No classes to refresh this time.</p>
      )}

      {report.mode === "quick" && report.courses.length > 0 && (
        <p className="mt-3 text-[13px] text-muted">A quick refresh only checks classes with work due recently or upcoming.</p>
      )}
      {skipped && <p className="mt-3 text-[13px] text-muted">{skipped}</p>}
    </div>
  );
}
