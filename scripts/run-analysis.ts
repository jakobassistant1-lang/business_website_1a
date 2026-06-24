// Run the AI assignment analysis (effort + summary + requiresAction screen) for a
// synced user, the same call the app fires on page-load (/api/analyze → runAnalysis).
// Useful for script-populated sandboxes that never had a browser session to trigger
// it. Batched (MAX_BATCH); paced + retried so Gemini's free-tier per-minute limit
// (429 → ok=false) doesn't leave the user half-analyzed. Writes results.
// Run: npx tsx --env-file=.env scripts/run-analysis.ts [userId]
import { prisma } from "../lib/prisma";
import { runAnalysis } from "../lib/analysisStore";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const arg = Number(process.argv[2]);
  let userId = Number.isFinite(arg) ? arg : NaN;
  if (!Number.isFinite(userId)) {
    const grouped = await prisma.assignment.groupBy({ by: ["userId"], _count: { _all: true } });
    if (grouped.length === 0) return console.log("No synced assignments.");
    userId = grouped.sort((a, b) => b._count._all - a._count._all)[0].userId;
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  console.log(`Analyzing assignments for user #${userId} (${user.email})…`);
  for (let pass = 1; pass <= 8; pass++) {
    let r = await runAnalysis(userId);
    for (let retry = 0; !r.ok && retry < 4; retry++) {
      const wait = 15000 * (retry + 1); // back off: 15s, 30s, 45s, 60s
      console.log(`  pass ${pass}: failed (likely 429) — waiting ${wait / 1000}s then retrying…`);
      await sleep(wait);
      r = await runAnalysis(userId);
    }
    console.log(`  pass ${pass}: analyzed ${r.analyzed}, skipped ${r.skipped}, ok=${r.ok}`);
    if (!r.ok || r.analyzed === 0) break;
    await sleep(5000); // pace successive batches under the per-minute limit
  }
  const flagged = await prisma.assignment.findMany({
    where: { userId, aiRequiresAction: false },
    select: { name: true },
  });
  console.log(`\nFlagged requiresAction=false (${flagged.length}): ${flagged.map((f) => f.name).join(", ") || "(none)"}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
