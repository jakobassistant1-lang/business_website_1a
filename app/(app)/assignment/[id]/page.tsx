import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { fetchAssignmentRubric, type CanvasRubricCriterion } from "@/lib/canvas";
import { itemType } from "@/lib/itemType";
import { ymd } from "@/lib/calendarDates";
import { AssignmentPage } from "@/components/AssignmentPage";

export const dynamic = "force-dynamic";

// /assignment/[id] — the rich leaf for an assignment: submission status, the AI
// "how to approach" + sub-steps, the Canvas description, and (best-effort) rubric.
export default async function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canvasId = Number(id);
  const user = await getCurrentUser(); // layout guarantees auth
  if (!user || !Number.isFinite(canvasId)) notFound();

  const a = await prisma.assignment.findUnique({ where: { userId_canvasId: { userId: user.id, canvasId } }, include: { course: true } });
  if (!a) notFound();

  // Best-effort live rubric (fetchAssignmentRubric fails open to null).
  let rubric: CanvasRubricCriterion[] | null = null;
  const cred = await prisma.canvasCredential.findUnique({ where: { userId: user.id } });
  if (cred) rubric = await fetchAssignmentRubric(cred.host, decryptSecret(cred.token), a.courseCanvasId, a.canvasId);

  return (
    <AssignmentPage
      canvasId={a.canvasId}
      name={a.name}
      courseName={a.course.name}
      type={itemType(a.submissionType, a.name)}
      dueAt={a.dueAt ? a.dueAt.toISOString() : null}
      points={a.pointsPossible ?? null}
      htmlUrl={a.htmlUrl ?? null}
      description={a.description ?? null}
      submissionState={a.submissionState ?? null}
      submissionScore={a.submissionScore ?? null}
      summary={a.aiSummary ?? null}
      rubric={rubric}
      todayYmd={ymd(new Date())}
    />
  );
}
