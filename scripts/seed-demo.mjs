// Load demo coursework straight into the app's database so you can try StudyPlan
// without a real Canvas account. Targets one existing user (your account email)
// and gives them a "connected" Canvas + a realistic spread of coursework across
// 4 classes and every assignment/assessment type.
//
// Needs DATABASE_URL pointing at the live (Neon) database. Run:
//   node scripts/seed-demo.mjs you@youremail.com
//
// Hitting "Sync from Canvas" in the app shows a harmless "couldn't reach Canvas"
// notice — the seeded data stays. To remove it later:
//   node scripts/seed-demo.mjs you@email --clear

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const email = (process.argv[2] || "").trim().toLowerCase();
const clear = process.argv.includes("--clear");
if (!email) {
  console.error("Usage: node scripts/seed-demo.mjs <your-account-email> [--clear]");
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { email } });
if (!user) {
  console.error(`No user with email ${email}. Sign up on the site first, then re-run.`);
  process.exit(1);
}

if (clear) {
  const a = await prisma.assignment.deleteMany({ where: { userId: user.id } });
  const c = await prisma.course.deleteMany({ where: { userId: user.id } });
  await prisma.canvasCredential.deleteMany({ where: { userId: user.id } });
  console.log(`Cleared ${a.count} assignments, ${c.count} courses, and the demo connection for ${email}.`);
  await prisma.$disconnect();
  process.exit(0);
}

const now = new Date();
const at = (days, hour = 17) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
};

await prisma.canvasCredential.upsert({
  where: { userId: user.id },
  update: { lastValidationStatus: "valid", lastValidatedAt: now, syncedAt: now, accountName: "Demo data" },
  create: {
    userId: user.id,
    host: "demo.local",
    apiBase: "https://demo.local/api/v1",
    token: "demo",
    lastValidationStatus: "valid",
    lastValidatedAt: now,
    syncedAt: now,
    accountName: "Demo data",
  },
});

const courses = [
  { canvasId: 90001, name: "CS 350 · Databases" },
  { canvasId: 90002, name: "MATH 241 · Calculus III" },
  { canvasId: 90003, name: "WRIT 220 · Rhetoric" },
  { canvasId: 90004, name: "BIO 110 · Cell Biology" },
];
const courseRows = {};
for (const c of courses) {
  courseRows[c.canvasId] = await prisma.course.upsert({
    where: { userId_canvasId: { userId: user.id, canvasId: c.canvasId } },
    update: { name: c.name },
    create: { userId: user.id, canvasId: c.canvasId, name: c.name },
  });
}

// A realistic spread: every type (assignment, quiz, exam/test, discussion, lab,
// essay, project), some overdue/today/this-week, one undated, one completed.
// `sub` is the Canvas submission_types value (drives the TYPE classification).
const items = [
  // CS 350 · Databases
  { id: 91001, c: 90001, name: "Discussion: Normalization", due: at(-1), pts: 20, sub: "discussion_topic" },
  { id: 91002, c: 90001, name: "Problem Set 4", due: at(1), pts: 100, sub: "online_upload" },
  { id: 91003, c: 90001, name: "Lab: B-Tree Indexing", due: at(2), pts: 50, sub: "online_upload" },
  { id: 91004, c: 90001, name: "Quiz 3: Joins", due: at(3), pts: 30, sub: "online_quiz" },
  { id: 91005, c: 90001, name: "Midterm Exam", due: at(5), pts: 150, sub: "online_quiz" },
  // MATH 241 · Calculus III
  { id: 91006, c: 90002, name: "Homework 6", due: at(0), pts: 40, sub: "online_upload" },
  { id: 91007, c: 90002, name: "Quiz 4: Vector Fields", due: at(2), pts: 25, sub: "online_quiz" },
  { id: 91008, c: 90002, name: "Problem Set 5", due: at(4), pts: 60, sub: "online_upload" },
  { id: 91009, c: 90002, name: "Unit Test 2", due: at(6), pts: 100, sub: "online_quiz" },
  // WRIT 220 · Rhetoric
  { id: 91010, c: 90003, name: "Reading response 6", due: at(1), pts: 20, sub: "online_text_entry" },
  { id: 91011, c: 90003, name: "Essay draft", due: at(2), pts: 100, sub: "online_upload" },
  { id: 91012, c: 90003, name: "Peer review", due: at(4), pts: 40, sub: "online_text_entry" },
  { id: 91013, c: 90003, name: "Final project proposal", due: at(6), pts: 100, sub: "online_upload" },
  { id: 91014, c: 90003, name: "Participation (ongoing)", due: null, pts: null, sub: "none" },
  // BIO 110 · Cell Biology
  { id: 91015, c: 90004, name: "Quiz 2: Membranes", due: at(1), pts: 20, sub: "online_quiz" },
  { id: 91016, c: 90004, name: "Lab report 3", due: at(3), pts: 50, sub: "online_upload" },
  { id: 91017, c: 90004, name: "Final Exam review", due: at(6), pts: 0, sub: "online_quiz", note: "exam" },
  // Completed (shows in the Completed section + damps its priority)
  { id: 91018, c: 90004, name: "Homework 1", due: at(-3), pts: 40, sub: "online_upload", submittedAt: at(-4), score: 37, state: "graded" },
];

for (const a of items) {
  const data = {
    userId: user.id,
    courseId: courseRows[a.c].id,
    courseCanvasId: a.c,
    name: a.name,
    dueAt: a.due,
    pointsPossible: a.pts ?? null,
    htmlUrl: `https://demo.local/courses/${a.c}/assignments/${a.id}`,
    submissionType: a.sub ?? null,
    submittedAt: a.submittedAt ?? null,
    submissionScore: a.score ?? null,
    submissionState: a.state ?? null,
  };
  await prisma.assignment.upsert({
    where: { userId_canvasId: { userId: user.id, canvasId: a.id } },
    update: data,
    create: { canvasId: a.id, ...data },
  });
}

console.log(`Seeded ${items.length} items across ${courses.length} courses for ${email}.`);
console.log("Open the Calendar / Timeline on the live site to see them.");
await prisma.$disconnect();
