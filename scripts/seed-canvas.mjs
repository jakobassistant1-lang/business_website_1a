// Seed a Canvas course with realistic test assignments so you can try StudyPlan
// even when your real account is empty (e.g. over the summer).
//
// Use an account where YOU are the teacher — a free "Free for Teachers" account
// at https://canvas.instructure.com works. Create one course first, then run:
//
//   CANVAS_HOST=canvas.instructure.com CANVAS_TOKEN=your_token node scripts/seed-canvas.mjs [courseId]
//
// It finds your teacher course (or uses the courseId you pass) and creates a
// spread of assignments — overdue, due today, this week, and one with no due
// date — with varied point values, so every part of the app has data.

const host = (process.env.CANVAS_HOST || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
const token = process.env.CANVAS_TOKEN || "";
const courseArg = process.argv[2];

if (!host || !token) {
  console.error("Missing CANVAS_HOST and/or CANVAS_TOKEN.");
  console.error("Example:");
  console.error("  CANVAS_HOST=canvas.instructure.com CANVAS_TOKEN=xxxx node scripts/seed-canvas.mjs");
  process.exit(1);
}

const base = `https://${host}/api/v1`;
const authHeader = { Authorization: `Bearer ${token}` };

async function api(path, opts = {}) {
  const res = await fetch(`${base}${path}`, { ...opts, headers: { ...authHeader, ...(opts.headers || {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${opts.method || "GET"} ${path} → HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Resolve which course to seed (must be one you teach).
let courseId = courseArg;
if (!courseId) {
  const courses = await api("/courses?enrollment_type=teacher&per_page=100");
  if (!Array.isArray(courses) || courses.length === 0) {
    console.error("No teacher courses found. In Canvas, create a course first");
    console.error("(Dashboard → Start a New Course), then re-run this script.");
    process.exit(1);
  }
  courseId = courses[0].id;
  console.log(`Using course: ${courses[0].name} (id ${courseId})`);
}

const now = new Date();
const at = (days, hour = 17) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const ASSIGNMENTS = [
  { name: "Reading response 6", due: at(-1), pts: 20 }, // overdue
  { name: "Discussion post", due: at(0), pts: 30 }, // due today
  { name: "Problem Set 4", due: at(1), pts: 100 }, // tomorrow, high stakes
  { name: "Lab: Indexing", due: at(1), pts: 50 },
  { name: "Essay draft", due: at(2), pts: 100 },
  { name: "Quiz 3", due: at(3), pts: 30 },
  { name: "Peer review", due: at(5), pts: 40 },
  { name: "Final project proposal", due: at(7), pts: 100 },
  { name: "Participation (ongoing)", due: null, pts: null }, // no due date
];

let created = 0;
for (const a of ASSIGNMENTS) {
  const body = new URLSearchParams();
  body.set("assignment[name]", a.name);
  body.set("assignment[published]", "true");
  body.set("assignment[submission_types][]", "online_text_entry");
  if (a.due) body.set("assignment[due_at]", a.due);
  if (a.pts != null) body.set("assignment[points_possible]", String(a.pts));
  await api(`/courses/${courseId}/assignments`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  created++;
  console.log(`  + ${a.name}`);
}

console.log(
  `\nCreated ${created} assignments in course ${courseId}.\n` +
    "Now open StudyPlan → Connections, connect this Canvas account (domain + token), and hit Sync.",
);
