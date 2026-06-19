import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadCalendarData } from "@/lib/calendarData";
import { studySessionsFor } from "@/lib/study";
import { StudyTools } from "@/components/StudyTools";

export const dynamic = "force-dynamic";

// One test's study tools (plan / guide / practice), reached from the hub's
// cards or the "Study" buttons across the app. A test that isn't an upcoming
// quiz/exam anymore (done, past due, unknown id) falls back to the hub.
export default async function StudyToolsPage({ params }: { params: Promise<{ canvasId: string }> }) {
  const { canvasId } = await params;
  const id = /^[0-9]+$/.test(canvasId) ? Number(canvasId) : null;
  if (id === null) redirect("/study");

  const user = await getCurrentUser(); // (app)/layout guarantees auth
  const data = await loadCalendarData(user!.id);
  if (!data.connected) redirect("/study");

  // A study target is any active (not-done) quiz/exam — matching the hub's
  // `status === "normal"` PLUS overdue, so every test the lists link here (undated,
  // due-earlier-today, or overdue) actually opens instead of bouncing back to the
  // hub. Done tests route to /assignment via itemHref, so they never reach here.
  const isStudyTarget = (it: (typeof data.items)[number]) => (it.type === "quiz" || it.type === "exam") && it.status !== "done";

  const assessment = data.items.find((it) => it.canvasId === id && isStudyTarget(it));
  if (!assessment) redirect("/study");

  // "Next up" = first study target in the same ranked order the hub uses.
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i]));
  const first = data.items.filter(isStudyTarget).sort((a, b) => {
    const ra = rank.get(a.canvasId) ?? 1e9;
    const rb = rank.get(b.canvasId) ?? 1e9;
    if (ra !== rb) return ra - rb;
    // Tiebreak only for unranked items: earliest due first, undated last (no `!`).
    const ta = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const tb = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    return ta - tb;
  })[0];

  return (
    <StudyTools
      assessment={assessment}
      sessions={studySessionsFor(data.plan, id)}
      isNextUp={first?.canvasId === assessment.canvasId}
    />
  );
}
