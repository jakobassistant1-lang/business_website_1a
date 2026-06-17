import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeToken } from "@/lib/passwordReset";
import { hashPassword } from "@/lib/password";

// POST — complete a password reset: { token, password }. The password rule (>= 8)
// matches signup and the account route. The password is validated BEFORE the token
// is consumed, so a too-short password doesn't burn the link. Any invalid / expired
// / already-used token returns the same generic error (no enumeration). On success
// we also delete the user's existing sessions, so anyone holding the old
// credentials (the reason they're resetting) is logged out.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token ?? "");
  const password = String(body.password ?? "");

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const userId = await consumeToken(token);
  if (userId === null) {
    return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }

  await prisma.user.update({ where: { id: userId }, data: { password: await hashPassword(password) } });
  await prisma.session.deleteMany({ where: { userId } });

  return NextResponse.json({ ok: true });
}
