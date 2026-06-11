import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { signupInviteCode } from "@/lib/signup";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// FR-1: sign up. Two doors:
//   • Student — open, NO invite code → a regular account (isAdmin = false).
//   • Admin   — requires the SIGNUP_INVITE_CODE (first time only) → the account
//               is remembered as admin (isAdmin = true); later they just log in.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const role = body.role === "admin" ? "admin" : "student";
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const fullName = String(body.fullName ?? "").trim();
  const phone = body.phone ? String(body.phone).trim() : null;
  const tosAccepted = body.tosAccepted === true;
  const inviteCode = String(body.inviteCode ?? "");

  const errors: Record<string, string> = {};
  if (role === "admin") {
    const code = signupInviteCode();
    if (!code) return NextResponse.json({ error: "Admin sign-up isn't enabled." }, { status: 403 });
    if (inviteCode !== code) errors.inviteCode = "Invalid invite code.";
  }
  if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";
  if (password.length < 8) errors.password = "Password must be at least 8 characters.";
  if (!fullName) errors.fullName = "Name is required.";
  if (!tosAccepted) errors.tos = "You must accept the Terms of Service.";
  if (Object.keys(errors).length) return NextResponse.json({ errors }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ errors: { email: "An account with this email already exists." } }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: { email, password: await hashPassword(password), fullName, phone, tosAcceptedAt: new Date(), isAdmin: role === "admin" },
  });
  await createSession(user.id);
  return NextResponse.json({ ok: true, isAdmin: role === "admin" });
}
