// Diagnostic: run the REAL Gemini analysis for the sandbox user, then print the
// prioritizer's recommended order, where assessments land, and whether the
// placeholder traps were screened out. Read-only except it persists analysis
// (effort/summary/requiresAction) — which is exactly what opening the app does.
// Run: NODE_ENV=development npx tsx --env-file=.env scripts/_canvas-rank-check.ts
import { prisma } from "../lib/prisma";
import { runAnalysis } from "../lib/analysisStore";
import { loadCalendarData } from "../lib/calendarData";

const USER = 5;
const TRAPS = [
  "Class Attendance",
  "Points from Answering Questions in Class",
  "Peer Evaluation Score (instructor-entered)",
  "TopHat Participation",
];
const cShort = (n?: string | null) => (n ?? "?").replace(/\s*[:(].*$/, "").split(" ").slice(0, 2).join(" ");

async function main() {
  let total = 0;
  for (let i = 0; i < 8; i++) {
    const r = await runAnalysis(USER);
    total += r.analyzed;
    console.log(`analysis pass ${i + 1}: analyzed=${r.analyzed} skipped=${r.skipped} ok=${r.ok}`);
    if (!r.ok || r.analyzed === 0) break;
  }
  console.log(`total newly analyzed: ${total}`);

  const traps = await prisma.assignment.findMany({
    where: { userId: USER, name: { in: TRAPS } },
    select: { canvasId: true, name: true, pointsPossible: true, dueAt: true, aiRequiresAction: true, aiSummary: true },
  });
  console.log("\n=== PLACEHOLDER TRAPS — Gemini requiresAction screen (want: false) ===");
  for (const p of traps) {
    const v = p.aiRequiresAction === false ? "SCREENED(false) ✅" : p.aiRequiresAction === true ? "KEPT(true) ❌" : "NOT ANALYZED(null) ⚠️";
    console.log(`${v} | ${p.name} (${p.pointsPossible}p) :: ${p.aiSummary ?? "(no summary)"}`);
  }

  const data = await loadCalendarData(USER);
  const itemBy = new Map(data.items.map((it) => [it.canvasId, it]));
  const screenedOut = data.items.length - data.ranked.length;
  console.log(`\n=== RECOMMENDED ORDER — today ${new Date().toISOString().slice(0, 10)} (active=${data.items.length}, ranked=${data.ranked.length}, screened out=${screenedOut}) ===`);
  data.ranked.slice(0, 40).forEach((r, i) => {
    const it = itemBy.get(r.canvasId);
    const tag = it ? `${it.type}${it.status === "overdue" ? "/OVERDUE" : ""}` : "?";
    console.log(`${String(i + 1).padStart(2)}. ${r.score.toFixed(1).padStart(5)} | ${cShort(it?.courseName).padEnd(10)} | ${r.name}  [${tag}] — ${r.reason}`);
  });

  console.log("\n=== ASSESSMENTS — where each lands in the full order ===");
  data.ranked.forEach((r, i) => {
    const it = itemBy.get(r.canvasId);
    if (it && (it.type === "exam" || it.type === "quiz")) {
      console.log(`#${String(i + 1).padStart(2)}/${data.ranked.length} | score=${r.score.toFixed(1)} | ${cShort(it.courseName)} | ${r.name} — ${r.reason}`);
    }
  });

  const rankedIds = new Set(data.ranked.map((r) => r.canvasId));
  console.log("\n=== placeholders present in the recommended order? (want: none) ===");
  for (const p of traps) console.log(`${rankedIds.has(p.canvasId) ? "PRESENT ❌" : "absent ✅"} | ${p.name}`);

  console.log("\n=== BOTTOM 12 (expect undated backfill + dead/overdue) ===");
  data.ranked.slice(-12).forEach((r) => {
    const it = itemBy.get(r.canvasId);
    const tag = it ? `${it.type}${it.status === "overdue" ? "/OVERDUE" : ""}` : "?";
    console.log(`${r.score.toFixed(1).padStart(5)} | ${cShort(it?.courseName).padEnd(10)} | ${r.name} [${tag}] — ${r.reason}`);
  });
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
