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

  const now = Date.now();
  const isUpcoming = (it: (typeof data.items)[number]) =>
    (it.type === "quiz" || it.type === "exam") && it.status !== "done" && it.dueAt !== null && new Date(it.dueAt).getTime() >= now;

  const assessment = data.items.find((it) => it.canvasId === id && isUpcoming(it));
  if (!assessment) redirect("/study");

  // "Next up" = first upcoming assessment in the same ranked order the hub uses.
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i]));
  const first = data.items.filter(isUpcoming).sort((a, b) => {
    const ra = rank.get(a.canvasId) ?? 1e9;
    const rb = rank.get(b.canvasId) ?? 1e9;
    if (ra !== rb) return ra - rb;
    return new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime();
  })[0];

  return (
    <StudyTools
      assessment={assessment}
      sessions={studySessionsFor(data.plan, id)}
      isNextUp={first?.canvasId === assessment.canvasId}
    />
  );
}
