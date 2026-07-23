import { notFound } from "next/navigation";
import DOMPurify from "isomorphic-dompurify";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { itemType } from "@/lib/itemType";
import { ymd } from "@/lib/calendarDates";
import { AssignmentPage } from "@/components/AssignmentPage";

export const dynamic = "force-dynamic";

// /assignment/[id] — the rich leaf for an assignment: submission status, the AI
// "how to approach" + sub-steps, the Canvas description, and (best-effort) rubric.
// The AI plan and the rubric are both fetched CLIENT-side (so neither blocks SSR).
export default async function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canvasId = Number(id);
  const user = await getCurrentUser(); // layout guarantees auth
  if (!user || !Number.isFinite(canvasId) || canvasId <= 0) notFound();

  const a = await prisma.assignment.findUnique({ where: { userId_canvasId: { userId: user.id, canvasId } }, include: { course: true } });
  if (!a) notFound();

  // Sanitize the Canvas-supplied HTML before the client renders it via
  // dangerouslySetInnerHTML — strips <script>, on*= handlers, javascript: URLs, etc.
  const description = a.description ? DOMPurify.sanitize(a.description) : null;

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
