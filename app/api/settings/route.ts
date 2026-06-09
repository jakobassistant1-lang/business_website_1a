import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// Settings: study budget (hours/day) + how far ahead to study for exams/quizzes.
export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const errors: Record<string, string> = {};
  const data: Record<string, unknown> = {};

  if (body.defaultHoursPerDay !== undefined) {
    const h = Number(body.defaultHoursPerDay);
    if (!(Number.isFinite(h) && h > 0 && h <= 24)) errors.defaultHoursPerDay = "Enter a number between 0 and 24.";
    else data.defaultHoursPerDay = h;
  }
  if (body.studyDaysTest !== undefined) {
    const t = Number(body.studyDaysTest);
    if (!(Number.isInteger(t) && t >= 1 && t <= 14)) errors.studyDaysTest = "Enter a whole number of days (1–14).";
    else data.studyDaysTest = t;
  }
  if (body.studyDaysQuiz !== undefined) {
    const q = Number(body.studyDaysQuiz);
    if (!(Number.isInteger(q) && q >= 1 && q <= 14)) errors.studyDaysQuiz = "Enter a whole number of days (1–14).";
    else data.studyDaysQuiz = q;
  }

  if (Object.keys(errors).length) return NextResponse.json({ errors }, { status: 400 });

  await prisma.user.update({ where: { id: user.id }, data });
  return NextResponse.json({ ok: true });
}
