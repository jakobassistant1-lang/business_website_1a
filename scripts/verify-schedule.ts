// Read-only: load the sandbox user's REAL week plan via the live loader and print
// it day-by-day, so we can see the new spaced sessions / chunks in action.
// Run: npx tsx --env-file=.env scripts/verify-schedule.ts
import { prisma } from "../lib/prisma";
import { loadCalendarData } from "../lib/calendarData";

async function main() {
  const g = await prisma.assignment.groupBy({ by: ["userId"], _count: { _all: true } });
  const userId = g.sort((a, b) => b._count._all - a._count._all)[0].userId;
  const data = await loadCalendarData(userId);
  const p = data.plan;
  console.log(`\nUser #${userId} · ${data.hoursPerDay}h/day budget · overload ${p.overloadHours}h · ${p.inWindowDueCount} in-window items\n`);
  for (const day of p.days) {
    const lines = day.blocks
      .filter((b) => b.hours > 0)
      .map((b) => `${b.hours}h ${b.study ? `study:${b.sessionKind ?? "?"}` : "work"} · ${b.name.replace(/\s+/g, " ").slice(0, 42)}`);
    console.log(`${day.weekday} ${day.date.slice(5)}  [${String(day.allocated).padStart(4)}h]`);
    lines.forEach((l) => console.log(`    ${l}`));
    if (lines.length === 0) console.log("    —");
  }
  console.log(`\nUndated (backfill): ${p.undated.length} · Overdue: ${p.atRisk.length}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
