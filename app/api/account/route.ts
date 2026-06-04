import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Edit profile (Account view).
export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const errors: Record<string, string> = {};
  const data: Record<string, unknown> = {};

  if (body.fullName !== undefined) {
    const fullName = String(body.fullName).trim();
    if (!fullName) errors.fullName = "Name is required.";
    else data.fullName = fullName;
  }
  if (body.phone !== undefined) {
    data.phone = body.phone ? String(body.phone).trim() : null;
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      errors.email = "Enter a valid email address.";
    } else {
      const other = await prisma.user.findUnique({ where: { email } });
      if (other && other.id !== user.id) errors.email = "An account with this email already exists.";
      else data.email = email;
    }
  }
  if (body.password) {
    const password = String(body.password);
    if (password.length < 8) errors.password = "Password must be at least 8 characters.";
    else data.password = await hashPassword(password);
  }

  if (Object.keys(errors).length) return NextResponse.json({ errors }, { status: 400 });

  await prisma.user.update({ where: { id: user.id }, data });
  return NextResponse.json({ ok: true });
}
