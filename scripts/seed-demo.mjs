// Load demo coursework straight into the app's database so you can try StudyPlan
// without a real Canvas account. Targets one existing user (your account email)
// and gives them a "connected" Canvas + a spread of assignments.
//
// Needs DATABASE_URL pointing at the live (Neon) database. Run:
//   node scripts/seed-demo.mjs you@youremail.com
//
// Note: this fakes the Canvas connection, so hitting "Sync from Canvas" in the
// app will show a harmless "couldn't reach Canvas" notice — the seeded data
// stays. To remove the demo data later: node scripts/seed-demo.mjs you@email --clear

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
  { canvasId: 90002, name: "WRIT 220 · Rhetoric" },
];
const courseRows = {};
for (const c of courses) {
  courseRows[c.canvasId] = await prisma.course.upsert({
    where: { userId_canvasId: { userId: user.id, canvasId: c.canvasId } },
    update: { name: c.name },
    create: { userId: user.id, canvasId: c.canvasId, name: c.name },
  });
}

// A spread across the planning window: overdue, today, this week, undated, and
// one already-submitted (so the "Completed" section + priority damper show too).
const items = [
  { id: 91001, c: 90001, name: "Discussion post", due: at(-1), pts: 30 },
  { id: 91002, c: 90002, name: "Reading response 6", due: at(0), pts: 20 },
  { id: 91003, c: 90001, name: "Problem Set 4", due: at(1), pts: 100 },
  { id: 91004, c: 90001, name: "Lab: Indexing", due: at(1), pts: 50 },
  { id: 91005, c: 90002, name: "Essay draft", due: at(2), pts: 100 },
  { id: 91006, c: 90001, name: "Quiz 3", due: at(3), pts: 30 },
  { id: 91007, c: 90002, name: "Peer review", due: at(5), pts: 40 },
  { id: 91008, c: 90001, name: "Final project proposal", due: at(6), pts: 100 },
  { id: 91009, c: 90002, name: "Participation (ongoing)", due: null, pts: null },
  { id: 91010, c: 90001, name: "Homework 2", due: at(-3), pts: 40, submittedAt: at(-4), score: 38, state: "graded" },
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

console.log(`Seeded ${items.length} assignments across ${courses.length} courses for ${email}.`);
console.log("Refresh the Plan page on the live site to see the plan + AI briefing.");
await prisma.$disconnect();
