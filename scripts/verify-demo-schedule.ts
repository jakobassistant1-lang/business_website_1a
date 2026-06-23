// Print the DEMO week plan (which has a midterm + quizzes in range) to see the
// new spaced study sessions. Run: npx tsx scripts/verify-demo-schedule.ts
import { buildDemoCalendarData } from "../lib/demoData";

const { data } = buildDemoCalendarData(new Date(2026, 5, 1, 9)); // fixed Mon for readability
const p = data.plan;
console.log(`\nDemo week plan · ${data.hoursPerDay}h/day · overload ${p.overloadHours}h\n`);
for (const day of p.days) {
  const lines = day.blocks
    .filter((b) => b.hours > 0)
    .map((b) => `${b.hours}h ${b.study ? `study:${b.sessionKind ?? "?"}` : "work "} · ${b.name}`);
  console.log(`${day.weekday} ${day.date.slice(5)}  [${String(day.allocated).padStart(4)}h]`);
  lines.forEach((l) => console.log(`    ${l}`));
  if (lines.length === 0) console.log("    —");
}
