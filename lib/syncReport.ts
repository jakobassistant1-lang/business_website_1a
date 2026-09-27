// Persisted sync report (#132): what the LAST Canvas sync did, per class, saved on
// CanvasCredential.lastSyncReport so the Connections page can show it after a
// reload. Pure (no Prisma, no React) — lib/sync.ts builds + writes it, the page
// parses + renders it. The stored JSON is untrusted on the way back in (old rows,
// hand edits, future versions), so parseSyncReport validates every field.
import { messageFor, type CanvasStatus } from "./messages";

export type SyncReportReason =
  | "unreachable"
  | "throttled"
  | "out_of_time"
  | "invalid_token"
  | "insufficient_scope"
  | "restricted"
  | "error";

export type SyncReportCourse = {
  canvasId: number;
  name: string;
  /** Assignments fetched + written for this class this run. 0 on a failed class
   *  (even if some rows were written before the failure — its cache is kept). */
  assignments: number;
  ok: boolean;
  reason?: SyncReportReason;
};

export type SyncReport = {
  version: 1;
  at: string; // ISO — when the run finished
  mode: "full" | "quick";
  ok: boolean; // the run's SyncResult.ok
  status: string; // the run's SyncResult.status (a CanvasStatus)
  courses: SyncReportCourse[];
  skippedNonStudent: number;
};

const REASONS: readonly SyncReportReason[] = [
  "unreachable",
  "throttled",
  "out_of_time",
  "invalid_token",
  "insufficient_scope",
  "restricted",
  "error",
];

/** Map a per-course CanvasStatus to a report reason. `quick` matters for 401/403:
 *  quick mode walks our CACHED course rows, so a 401/403 there means Canvas no
 *  longer shows this class (ended/dropped), not a bad token (see runQuickSync). */
export function reasonForStatus(status: CanvasStatus | string, opts?: { quick?: boolean }): SyncReportReason {
  switch (status) {
    case "unreachable":
    case "throttled":
      return status;
    case "invalid_token":
    case "insufficient_scope":
      return opts?.quick ? "restricted" : status;
    default:
      return "error";
  }
}

/** Plain-English "why this class wasn't refreshed". Connection-level reasons reuse
 *  the FR-5 copy in lib/messages (single source); only the report-specific ones
 *  are worded here. */
export function reasonText(reason: SyncReportReason): string {
  switch (reason) {
    case "unreachable":
    case "throttled":
    case "invalid_token":
    case "insufficient_scope":
      return messageFor(reason);
    case "out_of_time":
      return "Ran out of time this run — it'll refresh next sync";
    case "restricted":
      return "Canvas hides this class's assignments";
    case "error":
    default:
      return "Something went wrong refreshing this class — it'll retry next sync";
  }
}

const CANVAS_STATUSES: readonly CanvasStatus[] = ["valid", "invalid_token", "bad_domain", "unreachable", "insufficient_scope", "throttled", "error"];

/** The run-level line for a run that didn't succeed (null when it did). When
 *  every listed class is Canvas-hidden (quick mode's 401/403s) the run status is
 *  a stand-in ("unreachable"), so say what the rows say instead. Otherwise the
 *  FR-5 copy for the run's status (lib/messages — single source). `reason` drives
 *  the tone. */
export function runSummary(report: Pick<SyncReport, "ok" | "status" | "courses">): { text: string; reason: SyncReportReason } | null {
  if (report.ok) return null;
  if (report.courses.length > 0 && report.courses.every((c) => !c.ok && c.reason === "restricted")) {
    return { text: "Canvas hides the assignments for all of these classes — they may have ended.", reason: "restricted" };
  }
  const status = (CANVAS_STATUSES as readonly string[]).includes(report.status) ? (report.status as CanvasStatus) : "error";
  return { text: messageFor(status), reason: reasonForStatus(status) };
}

/** One row's right-hand text: the count when refreshed, else the reason. */
export function courseLine(c: SyncReportCourse): string {
  if (c.ok) return `${c.assignments} assignment${c.assignments === 1 ? "" : "s"}`;
  return reasonText(c.reason ?? "error");
}

/** THE wording for teacher/TA-only classes skipped (#123) — used by both the sync
 *  message (lib/sync syncMessage, pinned by tests) and the Connections panel
 *  footer. Null when there are none. */
export function skippedNonStudentText(n: number): string | null {
  if (!(n > 0)) return null;
  return `Skipped ${n} non-student course(s).`;
}

export function buildSyncReport(input: {
  at: Date;
  mode: "full" | "quick";
  result: { ok: boolean; status: string };
  courses: SyncReportCourse[];
  skippedNonStudent?: number;
}): SyncReport {
  return {
    version: 1,
    at: input.at.toISOString(),
    mode: input.mode,
    ok: input.result.ok,
    status: input.result.status,
    courses: input.courses.map((c) => ({
      canvasId: c.canvasId,
      name: c.name,
      assignments: c.assignments,
      ok: c.ok,
      ...(c.ok || c.reason === undefined ? {} : { reason: c.reason }),
    })),
    skippedNonStudent: input.skippedNonStudent ?? 0,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
/** No real class has more; a bigger stored number is clamped, not trusted. */
export const MAX_REPORT_ASSIGNMENTS = 10_000;

function parseCourse(v: unknown): SyncReportCourse | null {
  if (!isObj(v)) return null;
  const { canvasId, name, assignments, ok, reason } = v;
  if (!isCount(canvasId) || canvasId === 0) return null; // positive integer
  if (typeof name !== "string" || name.trim() === "") return null;
  if (!isCount(assignments) || typeof ok !== "boolean") return null;
  if (reason !== undefined && !(typeof reason === "string" && (REASONS as readonly string[]).includes(reason))) return null;
  return {
    canvasId,
    name: name.trim(),
    assignments: Math.min(assignments, MAX_REPORT_ASSIGNMENTS),
    ok,
    ...(reason !== undefined ? { reason: reason as SyncReportReason } : {}),
  };
}

/** Defensive read of the stored JSON: any shape mismatch → null (never throws).
 *  Unknown extra fields are dropped; names are trimmed; duplicate canvasIds keep
 *  the first row; assignment counts are clamped to MAX_REPORT_ASSIGNMENTS. */
export function parseSyncReport(json: unknown): SyncReport | null {
  try {
    if (!isObj(json)) return null;
    const { version, at, mode, ok, status, courses, skippedNonStudent } = json;
    if (version !== 1) return null;
    if (typeof at !== "string" || Number.isNaN(new Date(at).getTime())) return null;
    if (mode !== "full" && mode !== "quick") return null;
    if (typeof ok !== "boolean" || typeof status !== "string") return null;
    if (!Array.isArray(courses) || !isCount(skippedNonStudent)) return null;
    const parsed: SyncReportCourse[] = [];
    const seen = new Set<number>();
    for (const c of courses) {
      const pc = parseCourse(c);
      if (!pc) return null;
      if (seen.has(pc.canvasId)) continue; // duplicate class → keep the first row
      seen.add(pc.canvasId);
      parsed.push(pc);
    }
    return { version: 1, at, mode, ok, status, courses: parsed, skippedNonStudent };
  } catch {
    return null;
  }
}
