import { prisma } from "@/lib/prisma";

// Limits for student-uploaded notes. Notes are PINNED into study generation
// (lib/study.ts) — always included, ahead of Canvas material — so these caps
// protect generation quality and cost: a handful of bounded notes per test can't
// crowd out the teacher's material or blow the model's context.
export const MAX_NOTES_PER_TEST = 8;
export const MAX_NOTE_CHARS = 20000; // hard cap on stored text per note
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB upload cap (also per image)
export const MAX_IMAGES_PER_NOTE = 10; // photo notes (handwriting → Gemini vision)

/** A note can only be attached to an assessment the requesting user owns. */
export async function ownsAssessment(userId: number, canvasId: number): Promise<boolean> {
  const found = await prisma.assignment.findFirst({ where: { userId, canvasId }, select: { id: true } });
  return !!found;
}
