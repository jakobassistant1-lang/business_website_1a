import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { itemType, isStudyType } from "@/lib/itemType";
import { loadCalendarData } from "@/lib/calendarData";
import { STUDY_PROMPT_KEYS } from "@/lib/settings";
import {
  STUDY_PROMPT_VERSION,
  collectStudyMaterial,
  generateStudyGuide,
  generateStudyPlan,
  generateStudyQuestions,
  isQuestionType,
  studyHash,
  studySessionsFor,
  type AssessmentMeta,
} from "@/lib/study";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // generation can take ~10-25s

// Cache freshness: a guide/questions row younger than this is served without
// re-fetching Canvas material; older rows revalidate against the material hash
// (Decision C — fewest model calls AND bounded Canvas traffic).
const REVALIDATE_MS = 24 * 60 * 60_000;

type Kind = "plan" | "guide" | "questions";

// POST /api/study — { canvasId, kind, questionType?, force? } → cached-or-fresh
// generation for one assessment. Single mutation-style endpoint because even a
// "read" may generate (and persist) content.
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const canvasId = Number(body.canvasId);
  const kind = body.kind as Kind;
  const force = body.force === true;
  const questionType = kind === "questions" ? body.questionType : "";
  if (!Number.isInteger(canvasId) || !["plan", "guide", "questions"].includes(kind)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (kind === "questions" && !isQuestionType(questionType)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const a = await prisma.assignment.findFirst({ where: { userId: user.id, canvasId }, include: { course: true } });
  if (!a) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const type = itemType(a.submissionType, a.name);
  if (!isStudyType(type)) return NextResponse.json({ error: "not_an_assessment" }, { status: 400 });

  const meta: AssessmentMeta = {
    canvasId,
    name: a.name,
    courseName: a.course.name,
    courseCanvasId: a.course.canvasId,
    type,
    dueAt: a.dueAt,
    pointsPossible: a.pointsPossible,
    description: a.description,
    aiSummary: a.aiSummary,
  };
  const qt = kind === "questions" ? (questionType as string) : "";
  const where = { userId_canvasId_kind_questionType: { userId: user.id, canvasId, kind, questionType: qt } };
  const cached = await prisma.studyGeneration.findUnique({ where });

  // Admin-tunable instruction (the /admin/ai "Study outputs" group). It's part
  // of the inputHash, and an edit AFTER a row was cached also defeats the 24h
  // fast-path below — prompt changes take effect on the next request.
  const promptRow = await prisma.setting.findUnique({ where: { key: STUDY_PROMPT_KEYS[kind] } });
  const instruction = promptRow?.value ?? null;
  const promptEditedAfterCache = !!(cached && promptRow && promptRow.updatedAt > cached.updatedAt);

  const serve = (content: unknown, isCached: boolean, generatedAt: Date) =>
    NextResponse.json({ ok: true, kind, questionType: qt || null, content, cached: isCached, generatedAt });

  // ---- plan: inputs are cheap (no Canvas network) → validate the hash every time
  if (kind === "plan") {
    const data = await loadCalendarData(user.id);
    const sessions = studySessionsFor(data.plan, canvasId);
    const hash = studyHash([
      STUDY_PROMPT_VERSION,
      "plan",
      canvasId,
      instruction,
      a.dueAt?.toISOString(),
      a.pointsPossible,
      type,
      a.aiSummary,
      ...sessions.map((s) => `${s.date}:${s.hours}`),
    ]);
    if (!force && cached && cached.inputHash === hash) return serve(JSON.parse(cached.content), true, cached.updatedAt);

    const gen = await generateStudyPlan(meta, sessions, instruction ?? undefined);
    if (!gen.ok) return NextResponse.json({ error: gen.reason }, { status: 502 });
    const content = JSON.stringify(gen.content);
    const row = await prisma.studyGeneration.upsert({
      where,
      update: { content, inputHash: hash },
      create: { userId: user.id, canvasId, kind, questionType: qt, content, inputHash: hash },
    });
    return serve(gen.content, false, row.updatedAt);
  }

  // ---- guide / questions: material requires Canvas calls → TTL-gated revalidation
  if (!force && cached && !promptEditedAfterCache && Date.now() - cached.updatedAt.getTime() < REVALIDATE_MS) {
    return serve(JSON.parse(cached.content), true, cached.updatedAt);
  }

  const cred = await prisma.canvasCredential.findUnique({ where: { userId: user.id } });
  if (!cred) return NextResponse.json({ error: "not_connected" }, { status: 409 });
  const announcements = await prisma.announcement.findMany({
    where: { userId: user.id, courseId: a.courseId },
    select: { title: true, message: true, postedAt: true },
    orderBy: { postedAt: "desc" },
    take: 30,
  });
  const material = await collectStudyMaterial(cred.host, decryptSecret(cred.token), meta, announcements);
  const hash = studyHash([
    STUDY_PROMPT_VERSION,
    kind,
    qt,
    canvasId,
    instruction,
    material.hash,
    a.name,
    a.dueAt?.toISOString(),
    a.pointsPossible,
  ]);
  if (!force && cached && cached.inputHash === hash) {
    // Same inputs — refresh the TTL so the next 24h serve straight from cache.
    const row = await prisma.studyGeneration.update({ where, data: { inputHash: hash } });
    return serve(JSON.parse(cached.content), true, row.updatedAt);
  }

  const gen =
    kind === "guide"
      ? await generateStudyGuide(meta, material, instruction ?? undefined)
      : await generateStudyQuestions(meta, material, questionType, instruction ?? undefined);
  if (!gen.ok) return NextResponse.json({ error: gen.reason }, { status: 502 });
  const content = JSON.stringify(gen.content);
  const row = await prisma.studyGeneration.upsert({
    where,
    update: { content, inputHash: hash },
    create: { userId: user.id, canvasId, kind, questionType: qt, content, inputHash: hash },
  });
  return serve(gen.content, false, row.updatedAt);
}
