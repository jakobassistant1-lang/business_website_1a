import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdmin } from "@/lib/admin";
import { parseStandupBody, standupHistoryQuery, toStandupDto, STANDUP_SELECT } from "@/lib/standup";

// Ticket #46 — admin standup log. withAdmin: non-admins get the same 404 as every
// other /api/admin/* route.

// GET /api/admin/standup — last 60 days of entries (newest first) + who "me" is.
// The page renders its first paint from the server, so the UI doesn't call this
// today; it stays as the ticket's read API (covered in tests/standup.test.ts).
export const GET = withAdmin(async (admin) => {
  const rows = await prisma.standupEntry.findMany(standupHistoryQuery(new Date()));
  return NextResponse.json({ entries: rows.map(toStandupDto), me: { name: admin.fullName, id: admin.id } });
});

// POST /api/admin/standup — save MY entry for a day. One entry per (date, author),
// enforced by @@unique([date, authorId]); saving again the same day edits it via a
// single atomic upsert (two tabs can't create two rows). authorId is always the
// admin's id on write. Note: a legacy row with authorId = null under the same
// author name is NOT matched (Postgres treats NULLs as distinct) — it stays as its
// own entry rather than being guessed at by name.
// The write is awaited before responding (Vercel freezes the function once the
// response is sent).
export const POST = withAdmin(async (admin, req) => {
  const parsed = parseStandupBody(await req.json().catch(() => null), new Date());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { date, yesterday, today, blockers } = parsed.value;

  const fields = { author: admin.fullName, yesterday, today, blockers };
  const saved = await prisma.standupEntry.upsert({
    where: { date_authorId: { date, authorId: admin.id } },
    update: fields,
    create: { ...fields, date, authorId: admin.id },
    select: STANDUP_SELECT,
  });
  return NextResponse.json({ entry: toStandupDto(saved) });
});
