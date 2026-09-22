import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { signupInviteCode } from "@/lib/signup";
import { rateLimit, ipOf } from "@/lib/rateLimit";
import { isUniqueViolation } from "@/lib/prismaErrors";
import { logEvent } from "@/lib/funnel";
import { sendWelcomeEmail } from "@/lib/welcomeEmail";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Best-effort per-IP throttle (shared limiter, lib/rateLimit.ts). Student signup
// is open, so this is a speed-bump against scripted mass-creation; generous
// enough that real testers never hit it.
const SIGNUP_LIMIT = { limit: 10, windowMs: 15 * 60_000 };

// FR-1: sign up. Two doors:
//   • Student — open, NO invite code → a regular account (isAdmin = false).
//   • Admin   — requires the SIGNUP_INVITE_CODE (first time only) → the account
//               is remembered as admin (isAdmin = true); later they just log in.
export async function POST(req: Request) {
  if (!rateLimit("signup", ipOf(req), SIGNUP_LIMIT).allowed) {
    return NextResponse.json({ error: "Too many sign-ups from here — try again in a few minutes." }, { status: 429 });
  }

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

  let user;
  try {
    user = await prisma.user.create({
      // New students get the first-run demo (onboardedAt null → /demo); admins skip it.
      data: { email, password: await hashPassword(password), fullName, phone, tosAcceptedAt: new Date(), isAdmin: role === "admin", onboardedAt: role === "admin" ? new Date() : null },
    });
  } catch (err) {
    // Double-submit race (#128): two concurrent signups for the same email both
    // pass the findUnique above; the loser hits the unique index. Same 409 as
    // the pre-check so the client copy is unchanged — never a 500.
    if (isUniqueViolation(err, "email")) {
      return NextResponse.json({ errors: { email: "An account with this email already exists." } }, { status: 409 });
    }
    throw err;
  }
  await createSession(user.id);
  void logEvent("signup_created", user.id, { door: "password" });
  // Fire-and-forget: a brand-new account gets exactly one welcome email. Never
  // awaited and never throws (lib/welcomeEmail), so a mail outage can't slow or
  // fail the signup response. Not reached on the 409/429 paths above.
  void sendWelcomeEmail(user, new URL(req.url).origin);
  return NextResponse.json({ ok: true, isAdmin: role === "admin" });
}
