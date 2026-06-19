import { CanvasStatus } from "./messages";

const TIMEOUT_MS = 10000; // FR-5 assumption

export class CanvasError extends Error {
  constructor(public status: CanvasStatus, public httpCode?: number) {
    super(status);
  }
}

/** Strip scheme/path/trailing slash; return bare lowercase host (FR-4.2). */
export function normalizeHost(input: string): string {
  let h = input.trim().replace(/^https?:\/\//i, "");
  h = h.split("/")[0].replace(/\/+$/, "");
  return h.toLowerCase();
}

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

async function canvasFetch(host: string, token: string, pathOrUrl: string): Promise<Response> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${apiBase(host)}${pathOrUrl}`;
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

export interface ValidationResult {
  status: CanvasStatus;
  accountName?: string;
  httpCode?: number;
}

/** FR-5: single test call GET /users/self. */
export async function validateCredentials(host: string, token: string): Promise<ValidationResult> {
  let res: Response;
  try {
    res = await canvasFetch(host, token, "/users/self");
  } catch (e) {
    if (e instanceof CanvasError) return { status: e.status };
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
async function fetchAll<T>(host: string, token: string, path: string): Promise<T[]> {
  let url: string | null = `${apiBase(host)}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
  const out: T[] = [];
  while (url) {
    const res = await canvasFetch(host, token, url);
    if (res.status === 401) throw new CanvasError("invalid_token", 401);
    if (res.status === 403) throw new CanvasError("insufficient_scope", 403);
    if (!res.ok) throw new CanvasError("error", res.status);
    const page = (await res.json()) as T[];
    out.push(...page);
    url = parseNextLink(res.headers.get("link"));
  }
  return out;
}

export interface CanvasCourse {
  id: number;
  name: string;
}
export interface CanvasAssignment {
  id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  html_url: string;
  description: string | null; // assignment body (HTML); used as AI context
  submission_types?: string[]; // e.g. ["online_quiz"], ["online_upload"] — used to classify item TYPE
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

export function fetchCourses(host: string, token: string): Promise<CanvasCourse[]> {
  return fetchAll<CanvasCourse>(host, token, "/courses?enrollment_state=active");
}

export function fetchAssignments(host: string, token: string, courseId: number): Promise<CanvasAssignment[]> {
  // include[]=submission fetches each student's submission in the same request (no extra API calls).
  return fetchAll<CanvasAssignment>(host, token, `/courses/${courseId}/assignments?include[]=submission`);
}

export function fetchAnnouncements(host: string, token: string, courseId: number): Promise<CanvasAnnouncement[]> {
  return fetchAll<CanvasAnnouncement>(
    host,
    token,
    `/courses/${courseId}/discussion_topics?only_announcements=true`
  );
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
export async function fetchSyllabus(host: string, token: string, courseId: number): Promise<string | null> {
  try {
    const res = await canvasFetch(host, token, `/courses/${courseId}?include[]=syllabus_body`);
    if (!res.ok) return null;
    const json = (await res.json()) as { syllabus_body?: string | null };
    return typeof json?.syllabus_body === "string" && json.syllabus_body.trim() ? json.syllabus_body : null;
  } catch {
    return null;
  }
}
