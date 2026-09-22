import { CanvasStatus } from "./messages";

const TIMEOUT_MS = 10000; // FR-5 assumption

export class CanvasError extends Error {
  constructor(public status: CanvasStatus, public httpCode?: number) {
    super(status);
  }
}

// normalizeHost moved to lib/host.ts (pure, client-safe) so the school picker can
// reuse it without pulling this module's node imports (dns/net) into the browser.
// Re-exported so existing importers (app/api/canvas/credentials) are unaffected.
export { normalizeHost } from "./host";

/** Local/sandbox Canvas (a Dockerized Canvas, localhost) serves plain HTTP, not
 *  HTTPS — detect those hosts so we don't try a TLS handshake that can't succeed. */
function isLocalCanvasHost(host: string): boolean {
  const h = host.split(":")[0].toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".docker") || h.endsWith(".local");
}

export function apiBase(host: string): string {
  // Public Canvas is always HTTPS. A local sandbox (e.g. canvas.docker) serves
  // HTTP — but honor that only OUTSIDE production, so the deployed app never makes
  // plaintext or loopback requests (keeps an SSRF path from opening up in prod).
  const scheme = process.env.NODE_ENV !== "production" && isLocalCanvasHost(host) ? "http" : "https";
  return `${scheme}://${host}/api/v1`;
}

/** Map a thrown fetch/network error to a CanvasStatus (FR-5 matrix). */
function networkErrorToStatus(e: unknown): CanvasStatus {
  if (e instanceof DOMException && e.name === "AbortError") return "unreachable";
  const code = (e as { cause?: { code?: string } })?.cause?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ECONNREFUSED") {
    return "bad_domain";
  }
  return "unreachable";
}

/**
 * Retry schedule for transient Canvas answers (#123): a rate limit (403 whose
 * body/header says so, or 429) and a 5xx (502/503/504) are retried up to
 * `attempts` times with 1s, 2s, 4s (+ jitter) waits, or `Retry-After` when Canvas
 * sends one (capped at `retryAfterCapMs`). Total waiting on ONE request never
 * exceeds `maxTotalWaitMs`, a retry is skipped when it would run past the
 * caller's `deadline`, and the per-attempt TIMEOUT_MS still applies. Frozen in
 * production; tests (NODE_ENV=test) shrink the waits.
 */
const RETRY_DEFAULTS = { attempts: 3, baseMs: 1000, jitterMs: 250, retryAfterCapMs: 8000, maxTotalWaitMs: 10_000 };
export const CANVAS_RETRY: typeof RETRY_DEFAULTS = process.env.NODE_ENV === "test" ? { ...RETRY_DEFAULTS } : Object.freeze({ ...RETRY_DEFAULTS });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Canvas rate limiting answers 403 — the same code as a missing scope — but with
 * "Rate Limit Exceeded" in the body and a non-positive X-Rate-Limit-Remaining.
 * A 403 is a THROTTLE (never a token/scope problem) when any of those hold.
 * Consumes the body: callers only reach this on a 403 they won't read anyway.
 */
export async function isThrottleResponse(res: Response): Promise<boolean> {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  const remaining = res.headers.get("x-rate-limit-remaining");
  if (remaining != null && remaining.trim() !== "") {
    const n = Number(remaining);
    if (Number.isFinite(n) && n <= 0) return true;
  }
  const text = await res.text().catch(() => "");
  if (/rate limit exceeded/i.test(text)) return true;
  try {
    const json = JSON.parse(text) as { errors?: unknown };
    const errors = Array.isArray(json?.errors) ? (json.errors as { message?: unknown }[]) : [];
    if (errors.some((e) => /rate limit/i.test(String(e?.message ?? "")))) return true;
  } catch {
    /* not JSON — nothing more to learn */
  }
  return false;
}

/** How long to wait before retry number `attempt` (0-based): Retry-After when
 *  present (seconds or HTTP-date, capped), else exponential 1s/2s/4s + jitter. */
function retryDelayMs(res: Response, attempt: number): number {
  const ra = res.headers.get("retry-after");
  if (ra && ra.trim() !== "") {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, CANVAS_RETRY.retryAfterCapMs);
    const at = Date.parse(ra);
    if (!Number.isNaN(at)) return Math.min(Math.max(at - Date.now(), 0), CANVAS_RETRY.retryAfterCapMs);
  }
  return CANVAS_RETRY.baseMs * 2 ** attempt + Math.floor(Math.random() * CANVAS_RETRY.jitterMs);
}

const RETRYABLE_5XX = new Set([502, 503, 504]);

/** One attempt: the raw request with the per-attempt timeout. Network failures
 *  and timeouts map to a CanvasStatus and are NOT retried. */
async function canvasFetchOnce(url: string, token: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    throw new CanvasError(networkErrorToStatus(e));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET with the throttle/5xx retry schedule (CANVAS_RETRY). A throttle that
 * outlives the retries throws CanvasError("throttled", 403|429) — the ONLY way a
 * 403 leaves here as anything but a genuine (non-throttle) 403, which callers
 * still map to insufficient_scope. A 5xx that outlives the retries is returned
 * as-is so each caller keeps its own mapping (fetchAll → "error", the fail-open
 * readers → null). `deadline` (epoch ms) is the caller's budget: a retry whose
 * wait would end past it is skipped and the request fails right away, so a
 * sync near its budget never sleeps into the route's hard deadline.
 */
async function canvasFetch(host: string, token: string, pathOrUrl: string, deadline?: number): Promise<Response> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${apiBase(host)}${pathOrUrl}`;
  let waitedMs = 0;
  for (let attempt = 0; ; attempt++) {
    const res = await canvasFetchOnce(url, token);
    const throttled = await isThrottleResponse(res); // true for 429 and rate-limit 403s
    if (!throttled && !RETRYABLE_5XX.has(res.status)) return res;
    const wait = retryDelayMs(res, attempt);
    const exhausted =
      attempt >= CANVAS_RETRY.attempts ||
      waitedMs + wait > CANVAS_RETRY.maxTotalWaitMs ||
      (deadline != null && Date.now() + wait > deadline);
    if (exhausted) {
      if (throttled) throw new CanvasError("throttled", res.status);
      return res;
    }
    await sleep(wait);
    waitedMs += wait;
  }
}

export interface ValidationResult {
  status: CanvasStatus;
  accountName?: string;
  httpCode?: number;
}

/** FR-5: single test call GET /users/self. */
export async function validateCredentials(host: string, token: string, deadline?: number): Promise<ValidationResult> {
  let res: Response;
  try {
    res = await canvasFetch(host, token, "/users/self", deadline);
  } catch (e) {
    // incl. "throttled" once the retries are exhausted — a busy Canvas, not a bad token
    if (e instanceof CanvasError) return { status: e.status, httpCode: e.httpCode };
    return { status: "unreachable" };
  }
  if (res.status === 200) {
    const body = (await res.json().catch(() => ({}))) as { name?: string };
    return { status: "valid", accountName: body.name };
  }
  if (res.status === 401) return { status: "invalid_token", httpCode: 401 };
  if (res.status === 404) return { status: "bad_domain", httpCode: 404 };
  return { status: "error", httpCode: res.status };
}

/** Parse the Canvas `Link` header and return the rel="next" URL, if any. */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

/** Follow Link pagination, requesting per_page=100 (FR-6.5). */
async function fetchAll<T>(host: string, token: string, path: string, deadline?: number): Promise<T[]> {
  let url: string | null = `${apiBase(host)}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
  const out: T[] = [];
  while (url) {
    const res = await canvasFetch(host, token, url, deadline);
    if (res.status === 401) throw new CanvasError("invalid_token", 401);
    // canvasFetch already turned a rate-limit 403 into CanvasError("throttled"):
    // a 403 that reaches here is a genuine permission problem.
    if (res.status === 403) throw new CanvasError("insufficient_scope", 403);
    if (!res.ok) throw new CanvasError("error", res.status);
    const page = (await res.json()) as T[];
    out.push(...page);
    url = parseNextLink(res.headers.get("link"));
  }
  return out;
}

export interface CanvasEnrollment {
  type?: string; // "student" | "StudentEnrollment" | "teacher" | …
  role?: string; // e.g. "StudentEnrollment" | "TaEnrollment" (the role name, when Canvas sends it)
  computed_current_score?: number | null; // 0–100, graded work only; null when hidden
  computed_current_grade?: string | null; // letter, e.g. "B+"
  grades?: {
    current_score?: number | null;
    current_grade?: string | null;
  };
}
export interface CanvasCourse {
  id: number;
  name: string;
  // Present when the request includes `include[]=total_scores` — the student's own
  // enrollment with Canvas-computed totals. An absent/null total means the
  // instructor hides totals OR nothing is graded yet (the caller never guesses).
  enrollments?: CanvasEnrollment[];
  /** A term-locked course comes back as a stub with only id + this flag (no name). */
  access_restricted_by_date?: boolean;
}

/** The student's own current course total from an include[]=total_scores course.
 *  Prefers the top-level computed_* fields, falls back to the nested grades object.
 *  Returns nulls when Canvas reports no total — we never invent a number. */
export function courseGradeFromEnrollment(c: CanvasCourse): { score: number | null; grade: string | null } {
  const enrs = c.enrollments ?? [];
  const enr =
    enrs.find((e) => e.type === "student" || e.type === "StudentEnrollment") ??
    enrs.find((e) => e.computed_current_score != null || e.grades?.current_score != null) ??
    enrs[0];
  const score = enr?.computed_current_score ?? enr?.grades?.current_score ?? null;
  const grade = enr?.computed_current_grade ?? enr?.grades?.current_grade ?? null;
  return {
    score: typeof score === "number" && Number.isFinite(score) ? score : null,
    grade: typeof grade === "string" && grade.trim() ? grade.trim() : null,
  };
}

export interface CanvasAssignmentGroup {
  id: number;
  name: string;
  group_weight: number | null; // percent (e.g. 25); 0/absent in points-based courses
  assignments?: { id: number; points_possible: number | null }[];
}
export interface CanvasAssignment {
  id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  html_url: string;
  description: string | null; // assignment body (HTML); used as AI context
  submission_types?: string[]; // e.g. ["online_quiz"], ["online_upload"] — used to classify item TYPE
  assignment_group_id?: number; // Canvas grade category — joined to assignment_groups for its weight
  /** Present when the request includes `include[]=submission` (canvas-mcp integration). */
  submission?: {
    submitted_at: string | null;
    score: number | null;
    submission_type: string | null;
    workflow_state: string | null; // "submitted" | "graded" | "unsubmitted" | "pending_review"
  };
}
export interface CanvasAnnouncement {
  id: number;
  title: string;
  message: string | null;
  posted_at: string | null;
  html_url: string;
}

function isStudentEnrollment(e: CanvasEnrollment): boolean {
  return /student/i.test(e?.type ?? "") || /student/i.test(e?.role ?? "");
}

/** Why a course was left out of a sync (#123). Counts only — the cache is never
 *  touched for a dropped course; it simply stops being refreshed. */
export interface CourseFetchStats {
  skippedNonStudent: number; // teacher/TA/observer/designer enrollments (no student one)
  skippedRestricted: number; // access_restricted_by_date stubs (no name, no data)
}

/**
 * Keep only courses the student is enrolled in AS A STUDENT and can access:
 *  - a term-locked stub (`access_restricted_by_date: true`) is dropped;
 *  - a course whose `enrollments` list is present and non-empty but has no
 *    student-type entry (teacher/TA/observer/designer) is dropped.
 * A course with no enrollment info at all is KEPT — we never drop a course we
 * can't classify (the enrollment_type=student query param already did the
 * server-side filtering; this is the belt to that suspender).
 */
export function filterStudentCourses(courses: CanvasCourse[], stats?: CourseFetchStats): CanvasCourse[] {
  const out: CanvasCourse[] = [];
  for (const c of courses) {
    if (c.access_restricted_by_date === true) {
      if (stats) stats.skippedRestricted++;
      continue;
    }
    const enrs = c.enrollments;
    if (Array.isArray(enrs) && enrs.length > 0 && !enrs.some(isStudentEnrollment)) {
      if (stats) stats.skippedNonStudent++;
      continue;
    }
    out.push(c);
  }
  return out;
}

/** The student's active courses. `enrollment_type=student` excludes courses the
 *  account teaches/TAs (by design — a TA's own grading queue is not their plan),
 *  and the client-side filter above drops what still slips through. Pass `stats`
 *  to learn how many were dropped (the sync result reports the count). */
export async function fetchCourses(host: string, token: string, opts?: { stats?: CourseFetchStats; deadline?: number }): Promise<CanvasCourse[]> {
  // include[]=total_scores attaches the student's own course total (computed_current_*)
  // so we can show their real grade — no extra calls, same read-only token.
  const raw = await fetchAll<CanvasCourse>(host, token, "/courses?enrollment_state=active&enrollment_type=student&include[]=total_scores", opts?.deadline);
  return filterStudentCourses(raw, opts?.stats);
}

/** The student's current grade (0–100) in a course, from its enrollments. Null
 *  when Canvas didn't return a score (e.g. ungraded course). Fails safe. */
export function currentScoreOf(course: CanvasCourse): number | null {
  const enr = (course.enrollments ?? []).find((e) => typeof e?.computed_current_score === "number");
  const s = enr?.computed_current_score;
  return typeof s === "number" && Number.isFinite(s) ? s : null;
}

/** A course's assignment groups (+ their assignments) — carries name + group_weight
 *  for the weighted grade calculator and the prioritizer. Fails OPEN ([] on error). */
export async function fetchAssignmentGroups(host: string, token: string, courseId: number, deadline?: number): Promise<CanvasAssignmentGroup[]> {
  try {
    return await fetchAll<CanvasAssignmentGroup>(host, token, `/courses/${courseId}/assignment_groups?include[]=assignments`, deadline);
  } catch {
    return [];
  }
}

export function fetchAssignments(host: string, token: string, courseId: number, deadline?: number): Promise<CanvasAssignment[]> {
  // include[]=submission fetches each student's submission in the same request (no extra API calls).
  return fetchAll<CanvasAssignment>(host, token, `/courses/${courseId}/assignments?include[]=submission`, deadline);
}

export function fetchAnnouncements(host: string, token: string, courseId: number, deadline?: number): Promise<CanvasAnnouncement[]> {
  return fetchAll<CanvasAnnouncement>(host, token, `/courses/${courseId}/discussion_topics?only_announcements=true`, deadline);
}

// Single-assignment rubric (best-effort, for the assignment-detail page). Returns
// null when the assignment has no rubric or the call fails — always fails open.
export interface CanvasRubricCriterion {
  description: string;
  longDescription: string | null;
  points: number;
}
export async function fetchAssignmentRubric(host: string, token: string, courseId: number, assignmentId: number): Promise<CanvasRubricCriterion[] | null> {
  try {
    const res = await canvasFetch(host, token, `/courses/${courseId}/assignments/${assignmentId}?include[]=rubric`);
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { rubric?: unknown } | null;
    const rubric = json?.rubric;
    if (!Array.isArray(rubric) || rubric.length === 0) return null;
    const out = rubric
      .map((r): CanvasRubricCriterion => {
        const c = (r ?? {}) as Record<string, unknown>;
        return {
          description: String(c.description ?? ""),
          longDescription: typeof c.long_description === "string" ? c.long_description : null,
          points: Number(c.points ?? 0),
        };
      })
      .filter((c) => c.description);
    return out.length ? out : null;
  } catch {
    return null;
  }
}

// --- Study-page material sources (modules / pages / syllabus) -----------------

export interface CanvasModuleItem {
  id: number;
  title: string;
  type: string; // "Assignment" | "Quiz" | "Page" | "File" | "ExternalUrl" | "SubHeader" | …
  content_id?: number; // Assignment/Quiz/File id (absent for Page/ExternalUrl)
  page_url?: string; // present for Page items
  external_url?: string;
}
export interface CanvasModule {
  id: number;
  name: string;
  position: number;
  items?: CanvasModuleItem[];
}

/** Modules with their items — Canvas's own unit structure; the strongest signal
 *  for "which material belongs to this test". */
export function fetchModules(host: string, token: string, courseId: number): Promise<CanvasModule[]> {
  return fetchAll<CanvasModule>(host, token, `/courses/${courseId}/modules?include[]=items`);
}

export interface CanvasPage {
  url: string;
  title: string;
  body: string | null; // HTML
}

/** One wiki page's body. Fails OPEN (null) — a deleted/unpublished page must
 *  never break study-guide generation. */
export async function fetchPageBody(host: string, token: string, courseId: number, pageUrl: string): Promise<CanvasPage | null> {
  try {
    const res = await canvasFetch(host, token, `/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`);
    if (!res.ok) return null;
    const json = (await res.json()) as CanvasPage;
    return typeof json?.title === "string" ? json : null;
  } catch {
    return null;
  }
}

export interface CanvasFile {
  id: number;
  display_name: string;
  "content-type": string; // e.g. "application/pdf" (hyphenated in Canvas's JSON)
  size: number; // bytes
  url: string; // pre-signed download URL (carries its own verifier token)
}

/** One file's metadata (name/type/size + a signed download URL). Fails open. */
export async function fetchFileMeta(host: string, token: string, fileId: number): Promise<CanvasFile | null> {
  try {
    const res = await canvasFetch(host, token, `/files/${fileId}`);
    if (!res.ok) return null;
    const json = (await res.json()) as CanvasFile;
    return typeof json?.url === "string" ? json : null;
  } catch {
    return null;
  }
}

/** Download a Canvas file via its pre-signed URL, size-capped. Fails open. The
 *  URL embeds its own auth verifier, so no Bearer header is needed (and Canvas
 *  redirects to raw storage where one would leak anyway). */
export async function downloadCanvasFile(url: string, maxBytes: number): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.byteLength <= maxBytes ? buf : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The course syllabus body (HTML) — often lists exam coverage. Fails open. */
export async function fetchSyllabus(host: string, token: string, courseId: number, deadline?: number): Promise<string | null> {
  try {
    const res = await canvasFetch(host, token, `/courses/${courseId}?include[]=syllabus_body`, deadline);
    if (!res.ok) return null;
    const json = (await res.json()) as { syllabus_body?: string | null };
    return typeof json?.syllabus_body === "string" && json.syllabus_body.trim() ? json.syllabus_body : null;
  } catch {
    return null;
  }
}
