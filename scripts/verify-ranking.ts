// Read-only sandbox check: load a real synced user's coursework and run the v1
// prioritizer over it, showing the INPUTS behind each rank (grade-share, timing,
// do-vs-study) so the ordering can be verified. No writes.
// Run: npx tsx --env-file=.env scripts/verify-ranking.ts
import { prisma } from "../lib/prisma";
import { rankActiveRows, courseTotalPoints } from "../lib/rankActive";
import { coerceLatePolicy } from "../lib/latePolicy";
import { itemType, isStudyType, requiresOnlineSubmission } from "../lib/itemType";
import { resolveWeight } from "../lib/gradeWeight";

const DAY = 86_400_000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const daysUntil = (due: Date | null, now: Date) => (due ? Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY) : null);

async function main() {
  const grouped = await prisma.assignment.groupBy({ by: ["userId"], _count: { _all: true } });
  if (grouped.length === 0) return console.log("No synced assignments.");
  const userId = grouped.sort((a, b) => b._count._all - a._count._all)[0].userId;
  const [user, rows, courses] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.assignment.findMany({ where: { userId }, include: { course: true } }),
    prisma.course.findMany({ where: { userId } }),
  ]);

  const isDone = (a: (typeof rows)[number]) => a.submittedAt !== null && a.submissionState !== "unsubmitted";
  const active = rows.filter((a) => !isDone(a));
  const now = new Date();
  const totals = courseTotalPoints(rows.map((a) => ({ courseCanvasId: a.courseCanvasId, pointsPossible: a.pointsPossible })));
  const shortCourse = (n: string) => n.replace(/^\d+\w*[:-]\s*/, "").split(" · ")[0].slice(0, 22);

  console.log(`\nUser #${userId} (${user.email}) · ${active.length} active assignments · today ${now.toISOString().slice(0, 10)}`);
  console.log("\nCourses — current grade · late policy · total points:");
  for (const c of courses) {
    const lp = c.latePolicyKind ? `${c.latePolicyKind}${c.latePolicyValue ? ` ${c.latePolicyValue}` : ""}` : "unknown→no-credit";
    console.log(`  ${shortCourse(c.name).padEnd(22)} grade ${String(c.currentScore ?? "—").padStart(4)} · late ${lp.padEnd(18)} · ${totals.get(c.canvasId) ?? 0} pts`);
  }

  const toRow = (a: (typeof active)[number]) => ({
    canvasId: a.canvasId, name: a.name, courseName: a.course.name, courseCanvasId: a.courseCanvasId,
    dueAt: a.dueAt, pointsPossible: a.pointsPossible, htmlUrl: a.htmlUrl, submissionType: a.submissionType,
    estimatedEffortHours: a.estimatedEffortHours ?? null,
    courseGrade: a.course.currentScore != null ? a.course.currentScore / 100 : null,
    gradeWeight: a.gradeWeight,
    latePolicy: a.course.latePolicyKind ? coerceLatePolicy({ kind: a.course.latePolicyKind, value: a.course.latePolicyValue }) : undefined,
    requiresAction: a.aiRequiresAction,
  });

  const excluded = active.filter(
    (a) => a.aiRequiresAction === false && !requiresOnlineSubmission(a.submissionType) && !isStudyType(itemType(a.submissionType, a.name)),
  );
  console.log(`\nDropped by the AI actionable-screen (${excluded.length}): ${excluded.map((a) => a.name).join(", ") || "(none yet — AI not run)"}`);

  // Per-item inputs, to read alongside the rank.
  const meta = new Map(active.map((a) => {
    const type = itemType(a.submissionType, a.name);
    const total = totals.get(a.courseCanvasId) ?? 0;
    const share = total > 0 && a.pointsPossible != null ? a.pointsPossible / total : null;
    return [a.canvasId, { gradePct: resolveWeight(a.gradeWeight ?? share, type) * 100, d: daysUntil(a.dueAt, now), study: isStudyType(type) }];
  }));

  const ranked = rankActiveRows(active.map(toRow), totals, user.defaultEffortHours, now);
  console.log(`\nRANKED ${ranked.length} items  —  score / grade-share / when / do|study / name\n`);
  console.log("  #  score  grade%   when         kind   name");
  ranked.forEach((r, i) => {
    const m = meta.get(r.canvasId)!;
    const when = m.d === null ? "no date" : m.d < 0 ? "OVERDUE" : m.d === 0 ? "today" : `${m.d}d`;
    console.log(
      `${String(i + 1).padStart(3)}  ${String(r.score).padStart(5)}  ${m.gradePct.toFixed(1).padStart(5)}%  ${when.padStart(8)}     ${(m.study ? "study" : "do").padEnd(5)}  ${r.name.slice(0, 46)}`,
    );
  });
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
