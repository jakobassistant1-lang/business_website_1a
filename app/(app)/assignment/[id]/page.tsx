import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { itemType } from "@/lib/itemType";
import { ymd } from "@/lib/calendarDates";
import { AssignmentPage } from "@/components/AssignmentPage";
import { sanitizeBrief } from "@/lib/sanitizeBrief";

export const dynamic = "force-dynamic";

// /assignment/[id] — the rich leaf for an assignment: submission status, the AI
// "how to approach" + sub-steps, the Canvas description, and (best-effort) rubric.
// The AI plan and the rubric are both fetched CLIENT-side (so neither blocks SSR).
export default async function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  const { id } = await params;
  const canvasId = Number(id);
  if (!Number.isFinite(canvasId) || canvasId <= 0) notFound();

  const [a, cred] = await Promise.all([
    prisma.assignment.findUnique({ where: { userId_canvasId: { userId: user.id, canvasId } }, include: { course: true } }),
    // Only the host: relative links/images in the brief resolve against the
    // student's Canvas (without it they are dropped). The token is never read.
    prisma.canvasCredential.findUnique({ where: { userId: user.id }, select: { host: true } }),
  ]);
  if (!a) notFound();

  // The Canvas-supplied HTML is sanitized HERE, on the server (lib/sanitizeBrief:
  // sanitize-html, no DOM/jsdom — jsdom in the server bundle broke this route on
  // Vercel with ERR_REQUIRE_ESM), so the brief renders formatted on first paint.
  // Only the sanitized string reaches the client; the raw HTML never does.
  const cleaned = a.description && a.description.trim() ? sanitizeBrief(a.description, cred?.host ?? null) : "";
  const safeHtml = cleaned.trim() ? cleaned : null;

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
      safeHtml={safeHtml}
      submissionState={a.submissionState ?? null}
      submittedAt={a.submittedAt ? a.submittedAt.toISOString() : null}
      submissionScore={a.submissionScore ?? null}
      summary={a.aiSummary ?? null}
      manuallyDone={a.manualDoneAt != null}
      todayYmd={ymd(new Date())}
    />
  );
}
