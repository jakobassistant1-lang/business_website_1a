import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// POST — disconnect Notion. Notion has no public token-revoke endpoint for OAuth
// tokens, so we just delete the stored connection (the student can also remove
// access from their Notion settings).
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await prisma.notionConnection.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ ok: true });
}
