/* One-off Canvas course cloner. Reads from a real (student) Canvas account and
 * rebuilds whole courses in a sandbox (where you're a teacher/admin), via the
 * Canvas REST API. Config + tokens come from ./.canvas-clone.env (gitignored).
 *
 *   npx tsx scripts/canvas-clone.ts list           → list your courses (pick IDs)
 *   npx tsx scripts/canvas-clone.ts plan            → read COURSE_IDS, print what would be copied (no writes)
 *   npx tsx scripts/canvas-clone.ts clone           → actually build them in the sandbox
 *
 * Faithful copy of: course + syllabus, assignments, announcements, discussions,
 * pages, quizzes (shell + AI-generated topic-relevant questions), modules+items,
 * and module files (PDFs etc.). Dates are shifted per-course so "today" lands at
 * that course's mid-point (keeps original spacing). Every write is fail-soft —
 * one bad item logs and the rest continue. */

import fs from "fs";
import path from "path";

// ─── config ──────────────────────────────────────────────────────────────────
function loadEnvFile(p: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}
const cfg = loadEnvFile(path.join(process.cwd(), ".canvas-clone.env"));
const BABSON = { host: cfg.BABSON_HOST, token: cfg.BABSON_TOKEN };
const SANDBOX = { host: cfg.SANDBOX_HOST, token: cfg.SANDBOX_TOKEN };
const ACCOUNT_ID = cfg.SANDBOX_ACCOUNT_ID || "1";
// Course IDs come from argv[3] (e.g. `clone 7515761,7515654`) or the env file.
const COURSE_IDS = (process.argv[3] || cfg.COURSE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

type Conn = { host: string; token: string };
const scheme = (host: string) => (/docker|localhost|127\.0\.0\.1|\.local$/.test(host) ? "http" : "https");
const apiBase = (host: string) => `${scheme(host)}://${host}/api/v1`;

// ─── HTTP ────────────────────────────────────────────────────────────────────
async function api<T = any>(c: Conn, method: string, p: string, body?: unknown): Promise<T> {
  const url = p.startsWith("http") ? p : `${apiBase(c.host)}${p}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, ...(body ? { "Content-Type": "application/json" } : {}), Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}
const parseNext = (link: string | null) => link?.split(",").map((s) => s.match(/<([^>]+)>;\s*rel="next"/)).find(Boolean)?.[1] ?? null;
async function apiAll<T = any>(c: Conn, p: string): Promise<T[]> {
  let url: string | null = `${apiBase(c.host)}${p}${p.includes("?") ? "&" : "?"}per_page=100`;
  const out: T[] = [];
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${c.token}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    out.push(...((await res.json()) as T[]));
    url = parseNext(res.headers.get("link"));
  }
  return out;
}

// ─── dates ───────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
function buildShift(dates: (string | null | undefined)[]): number {
  const ms = dates.filter(Boolean).map((d) => Date.parse(d as string)).filter((n) => Number.isFinite(n));
  if (ms.length === 0) return 0;
  const mid = (Math.min(...ms) + Math.max(...ms)) / 2;
  return Date.now() - mid; // shift so today == the course's mid-point
}
const shift = (iso: string | null | undefined, delta: number): string | null =>
  iso ? new Date(Date.parse(iso) + delta).toISOString() : null;

// ─── AI quiz questions ───────────────────────────────────────────────────────
type CanvasAnswer = { answer_text: string; answer_weight: number };
type CanvasQuestion = { question_name: string; question_text: string; question_type: string; points_possible: number; answers: CanvasAnswer[] };

// My simple authored shape → Canvas's question payload.
//   {type:"mc", prompt, choices:[…], correct:<index>}  {type:"tf", prompt, correct:<bool>}  {type:"sa", prompt, correct:<string>}
function toCanvasQuestions(raw: any[], points: number): CanvasQuestion[] {
  const n = raw.length || 1;
  const per = Math.max(1, Math.round((points || n) / n));
  const out: CanvasQuestion[] = [];
  raw.forEach((q: any, i: number) => {
    const text = String(q?.prompt ?? "").trim();
    if (!text) return;
    if (q.type === "mc" && Array.isArray(q.choices) && q.choices.length >= 2) {
      const ci = Number(q.correct);
      out.push({ question_name: `Question ${i + 1}`, question_text: text, question_type: "multiple_choice_question", points_possible: per, answers: q.choices.map((c: any, idx: number) => ({ answer_text: String(c), answer_weight: idx === ci ? 100 : 0 })) });
    } else if (q.type === "tf") {
      const t = q.correct === true || q.correct === "true";
      out.push({ question_name: `Question ${i + 1}`, question_text: text, question_type: "true_false_question", points_possible: per, answers: [{ answer_text: "True", answer_weight: t ? 100 : 0 }, { answer_text: "False", answer_weight: t ? 0 : 100 }] });
    } else if (q.type === "sa") {
      out.push({ question_name: `Question ${i + 1}`, question_text: text, question_type: "short_answer_question", points_possible: per, answers: [{ answer_text: String(q.correct ?? "").slice(0, 80) || "answer", answer_weight: 100 }] });
    }
  });
  return out;
}

// Authored question bank: scripts/clone-quizzes.json, keyed by the source quiz id.
// Written empty by the `quizzes` mode, filled in by hand, read back here at clone.
const BANK_PATH = path.join(process.cwd(), "scripts", "clone-quizzes.json");
function loadBank(): Map<number, any[]> {
  const map = new Map<number, any[]>();
  if (!fs.existsSync(BANK_PATH)) return map;
  try {
    const arr = JSON.parse(fs.readFileSync(BANK_PATH, "utf8"));
    if (Array.isArray(arr)) for (const e of arr) if (e && typeof e.quizId === "number" && Array.isArray(e.questions)) map.set(e.quizId, e.questions);
  } catch { /* malformed bank → fall back to a stub */ }
  return map;
}
const QUESTION_BANK = loadBank();

function genQuestions(quizId: number, courseName: string, quizTitle: string, points: number): CanvasQuestion[] {
  const authored = QUESTION_BANK.get(quizId);
  if (authored && authored.length) return toCanvasQuestions(authored, points);
  // Fallback only if a quiz was left unfilled — a generic on-topic stub, never empty.
  return toCanvasQuestions([
    { type: "mc", prompt: `Which best describes a key concept covered by "${quizTitle}" in ${courseName}?`, choices: ["The central idea of this topic", "An unrelated concept", "A concept from a different course", "None of the above"], correct: 0 },
    { type: "tf", prompt: `"${quizTitle}" is a topic studied in ${courseName}.`, correct: true },
    { type: "sa", prompt: `Name one important term or idea associated with "${quizTitle}".`, correct: quizTitle.split(/[:\-]/)[0].trim() },
  ], points);
}

// Strip HTML → readable text (for the bank descriptions I author against).
const stripText = (html: string, max = 600) =>
  html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim().slice(0, max);

// ─── read one course from the source ─────────────────────────────────────────
async function readCourse(id: string) {
  const course: any = await api(BABSON, "GET", `/courses/${id}?include[]=syllabus_body`);
  const assignments = await apiAll(BABSON, `/courses/${id}/assignments`);
  // Announcements are NOT in the default discussion_topics list — they need their own flag.
  const discussions = (await apiAll<any>(BABSON, `/courses/${id}/discussion_topics`)).filter((t) => !t.is_announcement);
  const announcements = await apiAll<any>(BABSON, `/courses/${id}/discussion_topics?only_announcements=true`);
  const quizzes = await apiAll<any>(BABSON, `/courses/${id}/quizzes`).catch(() => []);
  const modules = await apiAll<any>(BABSON, `/courses/${id}/modules?include[]=items`).catch(() => []);
  // Pages: the /pages INDEX can be DISABLED per course (e.g. FME → "That page has
  // been disabled"), which hides every page from a list call. But the pages still
  // exist and are linked as module items, and each page body fetches fine on its
  // own. So collect slugs from the index when it works AND from every module "Page"
  // item, dedupe, then fetch each body directly.
  const slugs = new Set<string>();
  const pageStubs = await apiAll<any>(BABSON, `/courses/${id}/pages`).catch(() => []);
  if (Array.isArray(pageStubs)) for (const ps of pageStubs) if (ps?.url) slugs.add(ps.url);
  for (const m of modules) for (const it of m.items ?? []) if (it.type === "Page" && it.page_url) slugs.add(it.page_url);
  const pages: any[] = [];
  for (const slug of slugs) {
    const full = await api<any>(BABSON, "GET", `/courses/${id}/pages/${encodeURIComponent(slug)}`).catch(() => null);
    if (full?.url) pages.push(full);
  }
  return { course, assignments, announcements, discussions, quizzes, pages, modules };
}

// ─── copy a module File item's file into the sandbox ─────────────────────────
async function copyFile(srcCourseId: string, destCourseId: number, fileId: number): Promise<number | null> {
  try {
    const meta: any = await api(BABSON, "GET", `/files/${fileId}`);
    if (!meta?.url || (meta.size ?? 0) > 25 * 1024 * 1024) return null;
    const dl = await fetch(meta.url);
    if (!dl.ok) return null;
    const buf = Buffer.from(await dl.arrayBuffer());
    const init: any = await api(SANDBOX, "POST", `/courses/${destCourseId}/files`, { name: meta.display_name, size: buf.byteLength, content_type: meta["content-type"], parent_folder_path: "/clone", on_duplicate: "rename" });
    const fd = new FormData();
    for (const [k, v] of Object.entries(init.upload_params ?? {})) fd.append(k, String(v));
    fd.append("file", new Blob([buf]), meta.display_name);
    const up = await fetch(init.upload_url, { method: "POST", body: fd });
    const created: any = await up.json().catch(() => null);
    return created?.id ?? null;
  } catch {
    return null;
  }
}

// ─── write one course into the sandbox ───────────────────────────────────────
async function cloneCourse(srcId: string, b: Awaited<ReturnType<typeof readCourse>>) {
  const name = b.course.name as string;
  const delta = buildShift([
    ...b.assignments.map((a: any) => a.due_at),
    ...b.quizzes.map((q: any) => q.due_at),
    ...b.announcements.map((a: any) => a.posted_at ?? a.created_at),
  ]);
  console.log(`\n=== ${name}  (shift ${Math.round(delta / DAY)}d → today ≈ mid-course) ===`);

  // 1) course + syllabus, published
  const created: any = await api(SANDBOX, "POST", `/accounts/${ACCOUNT_ID}/courses`, {
    course: { name, course_code: b.course.course_code || name, syllabus_body: b.course.syllabus_body || undefined },
  });
  const cid = created.id as number;
  await api(SANDBOX, "PUT", `/courses/${cid}`, { course: { event: "offer" } }).catch(() => {});
  console.log(`  course #${cid} created + published`);

  const assignmentMap = new Map<number, number>();
  const quizMap = new Map<number, number>();
  const discussionMap = new Map<number, number>();
  const fileMap = new Map<number, number>();
  const pageUrlMap = new Map<string, string>();

  // 2) pages
  for (const p of b.pages) {
    try {
      const np: any = await api(SANDBOX, "POST", `/courses/${cid}/pages`, { wiki_page: { title: p.title, body: p.body ?? "", published: true } });
      pageUrlMap.set(p.url, np.url);
    } catch (e) { console.warn(`  page "${p.title}" failed: ${(e as Error).message.slice(0, 80)}`); }
  }
  console.log(`  pages: ${pageUrlMap.size}/${b.pages.length}`);

  // 3) assignments (skip quiz/discussion/LTI-backed ones — created via their own list)
  let aN = 0;
  for (const a of b.assignments) {
    const st: string[] = a.submission_types ?? [];
    if (st.includes("online_quiz") || st.includes("discussion_topic") || st.includes("external_tool") || st.includes("not_graded")) continue;
    try {
      const na: any = await api(SANDBOX, "POST", `/courses/${cid}/assignments`, {
        assignment: { name: a.name, description: a.description ?? "", points_possible: a.points_possible ?? 0, due_at: shift(a.due_at, delta), submission_types: st.length ? st : ["none"], published: true },
      });
      assignmentMap.set(a.id, na.id);
      aN++;
    } catch (e) { console.warn(`  assignment "${a.name}" failed: ${(e as Error).message.slice(0, 80)}`); }
  }
  console.log(`  assignments: ${aN}`);

  // 4) discussions
  for (const d of b.discussions) {
    try {
      const nd: any = await api(SANDBOX, "POST", `/courses/${cid}/discussion_topics`, { title: d.title, message: d.message ?? "", published: true });
      discussionMap.set(d.id, nd.id);
    } catch (e) { console.warn(`  discussion "${d.title}" failed: ${(e as Error).message.slice(0, 80)}`); }
  }
  console.log(`  discussions: ${discussionMap.size}/${b.discussions.length}`);

  // 5) announcements (future shifted date → schedule it; past → posts now)
  let anN = 0;
  for (const a of b.announcements) {
    const when = shift(a.posted_at ?? a.created_at, delta);
    const future = when && Date.parse(when) > Date.now();
    try {
      await api(SANDBOX, "POST", `/courses/${cid}/discussion_topics`, { title: a.title, message: a.message ?? "", is_announcement: true, published: true, ...(future ? { delayed_post_at: when } : {}) });
      anN++;
    } catch (e) { console.warn(`  announcement "${a.title}" failed: ${(e as Error).message.slice(0, 80)}`); }
  }
  console.log(`  announcements: ${anN}/${b.announcements.length}`);

  // 6) quizzes — shell + authored questions (from the bank), then publish
  let qN = 0;
  for (const q of b.quizzes) {
    try {
      const nq: any = await api(SANDBOX, "POST", `/courses/${cid}/quizzes`, {
        quiz: { title: q.title, description: q.description ?? "", quiz_type: q.quiz_type === "survey" ? "survey" : "assignment", points_possible: q.points_possible ?? undefined, due_at: shift(q.due_at, delta), published: false },
      });
      const questions = genQuestions(q.id, name, q.title, q.points_possible ?? 8);
      for (const qq of questions) await api(SANDBOX, "POST", `/courses/${cid}/quizzes/${nq.id}/questions`, { question: qq }).catch(() => {});
      await api(SANDBOX, "PUT", `/courses/${cid}/quizzes/${nq.id}`, { quiz: { published: true } }).catch(() => {});
      quizMap.set(q.id, nq.id);
      qN++;
      console.log(`    quiz "${q.title}" + ${questions.length} questions`);
    } catch (e) { console.warn(`  quiz "${q.title}" failed: ${(e as Error).message.slice(0, 80)}`); }
  }
  console.log(`  quizzes: ${qN}/${b.quizzes.length}`);

  // 7) modules + items (map content ids/urls; copy module files on demand)
  for (const m of b.modules) {
    try {
      const nm: any = await api(SANDBOX, "POST", `/courses/${cid}/modules`, { module: { name: m.name, published: true } });
      for (const it of m.items ?? []) {
        const base: any = { title: it.title, position: it.position, published: true, indent: it.indent };
        let payload: any = null;
        if (it.type === "Assignment" && assignmentMap.has(it.content_id)) payload = { ...base, type: "Assignment", content_id: assignmentMap.get(it.content_id) };
        else if (it.type === "Quiz" && quizMap.has(it.content_id)) payload = { ...base, type: "Quiz", content_id: quizMap.get(it.content_id) };
        else if (it.type === "Discussion" && discussionMap.has(it.content_id)) payload = { ...base, type: "Discussion", content_id: discussionMap.get(it.content_id) };
        else if (it.type === "Page" && pageUrlMap.has(it.page_url)) payload = { ...base, type: "Page", page_url: pageUrlMap.get(it.page_url) };
        else if (it.type === "ExternalUrl") payload = { ...base, type: "ExternalUrl", external_url: it.external_url, new_tab: true };
        else if (it.type === "SubHeader") payload = { ...base, type: "SubHeader" };
        else if (it.type === "File") {
          let fid = fileMap.get(it.content_id);
          if (fid === undefined) { const got = await copyFile(srcId, cid, it.content_id); if (got) { fileMap.set(it.content_id, got); fid = got; } }
          if (fid) payload = { ...base, type: "File", content_id: fid };
        }
        if (payload) await api(SANDBOX, "POST", `/courses/${cid}/modules/${nm.id}/items`, { module_item: payload }).catch((e) => console.warn(`    module item "${it.title}" failed: ${(e as Error).message.slice(0, 60)}`));
      }
      await api(SANDBOX, "PUT", `/courses/${cid}/modules/${nm.id}`, { module: { published: true } }).catch(() => {});
    } catch (e) { console.warn(`  module "${m.name}" failed: ${(e as Error).message.slice(0, 80)}`); }
  }
  console.log(`  modules: ${b.modules.length} (files copied: ${fileMap.size})`);
  console.log(`  ✓ done → ${scheme(SANDBOX.host)}://${SANDBOX.host}/courses/${cid}`);
}

// ─── modes ───────────────────────────────────────────────────────────────────
async function listCourses() {
  const seen = new Map<number, any>();
  for (const state of ["active", "completed"]) {
    const cs = await apiAll<any>(BABSON, `/courses?enrollment_state=${state}&include[]=term`).catch(() => []);
    for (const c of cs) if (c?.id && c.name) seen.set(c.id, c);
  }
  console.log(`\nYour Babson courses (${seen.size}):\n`);
  for (const c of [...seen.values()].sort((a, b) => (a.term?.name ?? "").localeCompare(b.term?.name ?? ""))) {
    console.log(`  ${String(c.id).padEnd(8)} ${c.name}`);
    console.log(`           term: ${c.term?.name ?? "—"}  |  ${c.start_at?.slice(0, 10) ?? c.term?.start_at?.slice(0, 10) ?? "?"} → ${c.end_at?.slice(0, 10) ?? c.term?.end_at?.slice(0, 10) ?? "?"}  |  code: ${c.course_code ?? "—"}`);
  }
  console.log(`\nPut the 3 you want (FME sem 1, Micro sem 1, Finance) in COURSE_IDS in .canvas-clone.env, comma-separated.\n`);
}

// `quizzes` — dump every quiz from the chosen courses into the bank file, with an
// empty `questions` array per quiz for me to author into. No writes to Canvas.
async function dumpQuizzes() {
  if (COURSE_IDS.length === 0) { console.error("No course IDs — pass them: `quizzes <id,id,id>`"); process.exit(1); }
  const bank: any[] = [];
  for (const id of COURSE_IDS) {
    const course: any = await api(BABSON, "GET", `/courses/${id}`);
    const quizzes = await apiAll<any>(BABSON, `/courses/${id}/quizzes`).catch(() => []);
    for (const q of quizzes) {
      bank.push({ courseId: id, course: course.name, quizId: q.id, title: q.title, points: q.points_possible ?? null, sourceQuestionCount: q.question_count ?? null, description: stripText(q.description ?? ""), questions: [] });
    }
    console.log(`${course.name}: ${quizzes.length} quizzes`);
  }
  fs.writeFileSync(BANK_PATH, JSON.stringify(bank, null, 2));
  console.log(`\nWrote ${bank.length} quizzes → ${BANK_PATH}\nFill each "questions" array, then run clone.\n`);
}

async function planOrClone(write: boolean) {
  if (COURSE_IDS.length === 0) { console.error("No course IDs — pass them as an arg (e.g. `clone 7515761,7515654,7779585`) or set COURSE_IDS."); process.exit(1); }
  for (const id of COURSE_IDS) {
    const b = await readCourse(id);
    if (!write) {
      console.log(`\n${b.course.name}: ${b.assignments.length} assignments · ${b.quizzes.length} quizzes · ${b.announcements.length} announcements · ${b.discussions.length} discussions · ${b.pages.length} pages · ${b.modules.length} modules`);
      continue;
    }
    await cloneCourse(id, b);
  }
  console.log(write ? "\nAll done.\n" : "\n(plan only — no writes. Run `clone` to build.)\n");
}

async function main() {
  const mode = process.argv[2];
  if (!BABSON.host || !BABSON.token) { console.error("Missing BABSON_HOST/BABSON_TOKEN in .canvas-clone.env"); process.exit(1); }
  if (mode === "list") return listCourses();
  if (mode === "quizzes") return dumpQuizzes();
  if (mode === "plan") return planOrClone(false);
  if (mode === "clone") {
    if (!SANDBOX.host || !SANDBOX.token) { console.error("Missing SANDBOX_HOST/SANDBOX_TOKEN in .canvas-clone.env"); process.exit(1); }
    return planOrClone(true);
  }
  console.error("Usage: npx tsx scripts/canvas-clone.ts <list|quizzes|plan|clone> [courseId,courseId,...]");
  process.exit(1);
}
main().then(() => process.exit(0)).catch((e) => { console.error("\nFATAL:", e.message); process.exit(1); });
