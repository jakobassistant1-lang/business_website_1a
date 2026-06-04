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

export function apiBase(host: string): string {
  return `https://${host}/api/v1`;
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
