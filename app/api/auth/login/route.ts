import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";

// FR-2: login. Generic error on bad credentials (FR-2.3).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  const user = await prisma.user.findUnique({ where: { email } });
  // Constant-ish work either way; bcrypt.compare returns false for a wrong hash.
  if (!user || !(await verifyPassword(password, user.password))) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
