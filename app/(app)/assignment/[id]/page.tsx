import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { itemType, type ItemType } from "@/lib/itemType";
import { effortOrDefault } from "@/lib/effort";
import { assignmentDoneReason } from "@/lib/assignmentStatus";
import { studentZone, todayInZone } from "@/lib/studentZone";
import { AssignmentPage } from "@/components/AssignmentPage";
import { sanitizeBrief } from "@/lib/sanitizeBrief";

export const dynamic = "force-dynamic";

// /assignment/[id] — the rich leaf for an assignment: submission status, the AI
// "how to approach" + sub-steps, the Canvas instructions (always shown), and
// (best-effort) rubric. The AI plan and the rubric are both fetched CLIENT-side
// (so neither blocks SSR). Dates are read in the student's Canvas zone.
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

  const zone = studentZone(user);
  const now = new Date();
  // Not open yet = Canvas's unlock date is still ahead: no AI plan, "Opens …".
  const opensAt = a.unlockAt && a.unlockAt.getTime() > now.getTime() ? a.unlockAt.toISOString() : null;

  // "Done" and its reason are THE shared rule (lib/assignmentStatus), so the badge
  // and the Mark-as-done control agree with every list.
  const type: ItemType = itemType(a.submissionType, a.name);
  const doneReason = assignmentDoneReason(a, { type, dueAt: a.dueAt, zone, now });
  const done = doneReason != null;

  return (
    <AssignmentPage
      key={a.canvasId} // remount on navigation so AI-plan state never leaks between assignments
      canvasId={a.canvasId}
      name={a.name}
      courseName={a.course.name}
      type={type}
      dueAt={a.dueAt ? a.dueAt.toISOString() : null}
      points={a.pointsPossible ?? null}
      // THE effort rule (lib/effort): the AI estimate padded once, or the student's
      // default hours; the student's own number is passed as typed (unpadded).
      estimatedEffortHours={effortOrDefault({ estimatedEffortHours: a.estimatedEffortHours }, user.defaultEffortHours)}
      effortOverrideHours={a.effortOverrideHours ?? null}
      htmlUrl={a.htmlUrl ?? null}
      safeHtml={safeHtml}
      submissionState={a.submissionState ?? null}
      submittedAt={a.submittedAt ? a.submittedAt.toISOString() : null}
      submissionScore={a.submissionScore ?? null}
      summary={a.aiSummary ?? null}
      manuallyDone={a.manualDoneAt != null}
      done={done}
      doneReason={doneReason}
      todayYmd={todayInZone(zone, now)}
      timeZone={zone}
      opensAt={opensAt}
    />
  );
}
