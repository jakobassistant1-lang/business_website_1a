// Verify the points->% conversion the SYSTEM uses (not hand-math): report FME's
// total points (the denominator), then break down the exact marginal-value math
// for Feasibility Slides vs Spreadsheet Exercise: Annuities so we can see precisely
// why one ranks above the other. Uses the real ranker functions on the synced DB.
import { prisma } from "../lib/prisma";
import { courseTotalPoints } from "../lib/rankActive";
import { scoreItem, captureFraction, leverage, type MarginalInput } from "../lib/marginalPriority";
import { resolveWeight } from "../lib/gradeWeight";
import { itemType, isStudyType } from "../lib/itemType";
import { DEFAULT_LATE_POLICY, coerceLatePolicy } from "../lib/latePolicy";
import { effectiveEffort } from "../lib/calendarData";

const USER = 5;
const DAY = 86_400_000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const daysUntil = (due: Date | null, now: Date) => (due ? Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY) : null);

async function main() {
  const now = new Date();
  const rows = await prisma.assignment.findMany({ where: { userId: USER }, include: { course: true } });
  const totals = courseTotalPoints(rows.map((a) => ({ courseCanvasId: a.courseCanvasId, pointsPossible: a.pointsPossible })));

  const feas = rows.find((a) => /Feasibility Presentation Slides/i.test(a.name))!;
  const ann = rows.find((a) => /Spreadsheet Exercise: Annuities/i.test(a.name))!;

  const fmeCid = feas.courseCanvasId;
  const fme = rows.filter((a) => a.courseCanvasId === fmeCid);
  const fmeTotal = totals.get(fmeCid) ?? 0;
  console.log(`=== FME COURSE — the pts->% denominator (system's own computation) ===`);
  console.log(`course: "${feas.course.name}"  (courseCanvasId=${fmeCid})`);
  console.log(`# assignments counted: ${fme.length}`);
  console.log(`FME TOTAL POINTS (Σ pointsPossible) = ${fmeTotal}`);
  console.log(`FME currentScore (grade leverage) = ${feas.course.currentScore ?? "null"}`);
  console.log(`FME rows with gradeWeight set (weighted-group %): ${fme.filter((a) => a.gradeWeight != null).length}/${fme.length}`);
  console.log(`\nFME items >= 300 pts → share of grade (pts / ${fmeTotal}):`);
  for (const a of fme.filter((a) => (a.pointsPossible ?? 0) >= 300).sort((x, y) => (y.pointsPossible ?? 0) - (x.pointsPossible ?? 0))) {
    const share = fmeTotal > 0 ? (a.pointsPossible! / fmeTotal) * 100 : null;
    console.log(`  ${String(a.pointsPossible).padStart(5)}pts → ${share != null ? share.toFixed(1) + "%" : "n/a"} | due ${a.dueAt ? a.dueAt.toISOString().slice(0, 10) : "—"} | ${a.name}`);
  }

  function breakdown(a: typeof rows[number], label: string) {
    const type = itemType(a.submissionType, a.name);
    const total = totals.get(a.courseCanvasId) ?? 0;
    const pointsShare = total > 0 && a.pointsPossible != null ? a.pointsPossible / total : null;
    const weight = resolveWeight(a.gradeWeight ?? pointsShare, type);
    const courseGrade = a.course.currentScore != null ? a.course.currentScore / 100 : null;
    const lp = a.course.latePolicyKind ? coerceLatePolicy({ kind: a.course.latePolicyKind, value: a.course.latePolicyValue }) : DEFAULT_LATE_POLICY;
    const input: MarginalInput = {
      canvasId: a.canvasId, name: a.name, courseName: a.course.name,
      kind: isStudyType(type) ? "study" : "assignment",
      weight, courseGrade, dueInDays: daysUntil(a.dueAt, now),
      effortHours: effectiveEffort(a) ?? 2, latePolicy: lp, submitted: false,
    };
    const lev = leverage(input.courseGrade);
    const capFrac = captureFraction(input);
    const s = scoreItem(input);
    console.log(`\n${label}: ${a.name}`);
    console.log(`  course="${a.course.name}" courseTotal=${total} pts`);
    console.log(`  points=${a.pointsPossible}  pointsShare=${pointsShare != null ? (pointsShare * 100).toFixed(2) + "%" : "null"}  gradeWeight=${a.gradeWeight ?? "null"}  → WEIGHT=${(weight * 100).toFixed(2)}%`);
    console.log(`  dueInDays=${input.dueInDays}  → captureFraction(urgency)=${capFrac.toFixed(4)}`);
    console.log(`  courseGrade=${courseGrade ?? "null"} → leverage=${lev.toFixed(3)}`);
    console.log(`  VALUE = leverage·weight·captureFraction = ${s.value.toExponential(4)}   ← the ranking key`);
    return s;
  }

  console.log(`\n=== WHY Feasibility ranks above Annuities (ranked by VALUE) ===`);
  const A = breakdown(feas, "A) FEASIBILITY SLIDES");
  const B = breakdown(ann, "B) SPREADSHEET: ANNUITIES");
  console.log(`\nFeasibility value ${A.value.toExponential(3)}  vs  Annuities value ${B.value.toExponential(3)}  →  ${A.value > B.value ? "Feasibility wins" : "Annuities wins"} (ratio ${(A.value / B.value).toFixed(2)}×)`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
