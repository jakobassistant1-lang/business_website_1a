// Does the week scheduler place study sessions for the upcoming exams? The Micro
// Midterm is 6 days out with a 7-day study lead, so its sessions SHOULD fall in
// the 7-day plan window — unless value=0 (study-urgency curve) starves them.
import { loadCalendarData } from "../lib/calendarData";

async function main() {
  const data = await loadCalendarData(5);
  const plan = data.plan as unknown as { days: { date?: string; blocks?: { name: string; study?: boolean; hours?: number; estimatedEffortHours?: number }[] }[] };
  const days = plan.days ?? [];
  console.log("overloadHours:", data.overloadHours, "| plan days:", days.length);
  if (days[0]) console.log("day keys:", Object.keys(days[0]), "| block keys:", days[0].blocks?.[0] ? Object.keys(days[0].blocks[0]) : "(no blocks day 0)");

  let study = 0, work = 0;
  const studyFor = new Set<string>();
  for (const d of days) for (const b of d.blocks ?? []) { if (b.study) { study++; studyFor.add(b.name); } else work++; }
  console.log(`\nblocks: study=${study}, work=${work}`);
  console.log("study sessions scheduled for:", studyFor.size ? [...studyFor] : "(NONE — no exam study scheduled in the 7-day window)");

  for (const d of days) {
    const bs = d.blocks ?? [];
    const label = bs.map((b) => `${b.study ? "📖" : "✍️"}${b.name.replace(/:.*/, "").slice(0, 22)}(${b.hours ?? b.estimatedEffortHours ?? "?"}h)`).join("  ");
    console.log(`${d.date ?? "?"}: ${label || "(empty)"}`);
  }
}
main().catch((e) => console.error(e)).finally(() => process.exit(0));
