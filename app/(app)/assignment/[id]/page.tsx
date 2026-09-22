import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { itemType } from "@/lib/itemType";
import { ymd } from "@/lib/calendarDates";
import { AssignmentPage } from "@/components/AssignmentPage";

export const dynamic = "force-dynamic";

// /assignment/[id] — the rich leaf for an assignment: submission status, the AI
// "how to approach" + sub-steps, the Canvas description, and (best-effort) rubric.
// The AI plan and the rubric are both fetched CLIENT-side (so neither blocks SSR).
export default async function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  const { id } = await params;
  const canvasId = Number(id);
  if (!Number.isFinite(canvasId) || canvasId <= 0) notFound();

  const a = await prisma.assignment.findUnique({ where: { userId_canvasId: { userId: user.id, canvasId } }, include: { course: true } });
  if (!a) notFound();

  // The Canvas-supplied HTML is passed through RAW. Sanitization happens in the
  // browser (components/AssignmentPage) — DOMPurify needs a real DOM, and pulling
  // jsdom into the server bundle broke this route on Vercel (ERR_REQUIRE_ESM).
  const description = a.description ?? null;

  return (
    <AssignmentPage
      key={a.canvasId} // remount on navigation so AI-plan state never leaks between assignments
      canvasId={a.canvasId}
      name={a.name}
      courseName={a.course.name}
      type={itemType(a.submissionType, a.name)}
      dueAt={a.dueAt ? a.dueAt.toISOString() : null}
      points={a.pointsPossible ?? null}
      estimatedEffortHours={a.estimatedEffortHours ?? null}
      effortOverrideHours={a.effortOverrideHours ?? null}
      htmlUrl={a.htmlUrl ?? null}
      description={description}
      submissionState={a.submissionState ?? null}
      submittedAt={a.submittedAt ? a.submittedAt.toISOString() : null}
      submissionScore={a.submissionScore ?? null}
      summary={a.aiSummary ?? null}
      manuallyDone={a.manualDoneAt != null}
      todayYmd={ymd(new Date())}
    />
  );
}
