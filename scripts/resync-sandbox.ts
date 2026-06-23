// Populate the v1 signals on the sandbox user: re-sync (current grade, weighted
// grade-shares, syllabus→late-policy) and re-analyze (AI requiresAction + effort).
// Run: npx tsx --env-file=.env scripts/resync-sandbox.ts
import { prisma } from "../lib/prisma";
import { runSync } from "../lib/sync";
import { runAnalysis } from "../lib/analysisStore";

async function main() {
  const grouped = await prisma.assignment.groupBy({ by: ["userId"], _count: { _all: true } });
  const userId = grouped.sort((a, b) => b._count._all - a._count._all)[0].userId;

  console.log(`Re-syncing user #${userId} (Canvas: grade + group weights + syllabus→late-policy)…`);
  const sync = await runSync(userId);
  console.log(`  sync ok=${sync.ok} status=${sync.status} — ${sync.message}`);

  console.log("Re-analyzing (Gemini: requiresAction + effort, version-bumped so all re-run)…");
  // runAnalysis does one batch (MAX_BATCH) per call; loop until it's caught up.
  for (let i = 0; i < 10; i++) {
    const an = await runAnalysis(userId);
    console.log(`  batch ${i + 1}: analyzed=${an.analyzed} ok=${an.ok}`);
    if (!an.ok || an.analyzed === 0) break;
  }

  const flagged = await prisma.assignment.count({ where: { userId, aiRequiresAction: false } });
  const graded = await prisma.course.count({ where: { userId, currentScore: { not: null } } });
  const withPolicy = await prisma.course.count({ where: { userId, latePolicyKind: { not: null } } });
  console.log(`\nResult: ${flagged} assignments flagged non-actionable · ${graded} courses with a grade · ${withPolicy} courses with a parsed late policy.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
