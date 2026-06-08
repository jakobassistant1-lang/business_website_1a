import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { revokeToken } from "@/lib/googleCalendar/auth";

export const dynamic = "force-dynamic";

// POST — one-click disconnect: revoke the token at Google (best-effort), then
// delete the connection (cascade removes the synced events).
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const conn = await prisma.googleCalendarConnection.findUnique({ where: { userId: user.id } });
  if (conn) {
    const toRevoke = conn.refreshToken ?? conn.accessToken;
    if (toRevoke) {
      try {
        await revokeToken(decryptSecret(toRevoke));
      } catch {
        /* decrypt/revoke failures must not block local disconnect */
      }
    }
    await prisma.googleCalendarConnection.delete({ where: { userId: user.id } });
  }
  return NextResponse.json({ ok: true });
}
