import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createResetToken } from "@/lib/passwordReset";
import { sendEmail } from "@/lib/email";
import { appOrigin } from "@/lib/appUrl";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Best-effort per-IP throttle (same shape as the signup route): a speed-bump
// against scripted abuse. In-memory → per serverless instance only, not a shared
// limiter; generous enough that a real user never hits it.
const RL_WINDOW_MS = 15 * 60_000;
const RL_MAX = 10;
const forgotHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (forgotHits.size > 5000) for (const [k, v] of forgotHits) if (now > v.resetAt) forgotHits.delete(k);
  const e = forgotHits.get(ip);
  if (!e || now > e.resetAt) {
    forgotHits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return false;
  }
  e.count += 1;
  return e.count > RL_MAX;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

// POST — request a password reset. ALWAYS returns the same { ok: true } whether or
// not the email has an account (or is a Google-only account), so the response
// can't be used to enumerate which emails are registered — matching the login
// route's generic-error philosophy. The exists / Google-only distinction is
// conveyed ONLY inside the email, which only the inbox owner can read.
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests — try again in a few minutes." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ ok: true }); // no-op, same shape

  const user = await prisma.user.findUnique({ where: { email } });
  // Public origin for the emailed link — resolved from TRUSTED config only (never
  // the request Host header), to prevent reset-link poisoning. See lib/appUrl.ts.
  const base = appOrigin(new URL(req.url).origin);

  if (user && user.password) {
    // Normal password account → send a reset link.
    const token = await createResetToken(user.id);
    const resetUrl = `${base}/reset-password?token=${token}`;
    await sendEmail({
      to: email,
      subject: "Reset your StudyPlan password",
      text:
        `Hi ${firstName(user.fullName)},\n\n` +
        `We received a request to reset the password for your StudyPlan account.\n\n` +
        `Reset it here (this link expires in 1 hour and can be used once):\n${resetUrl}\n\n` +
        `If you didn't request this, you can safely ignore this email — your password won't change.`,
    });
  } else if (user && !user.password) {
    // Google-only (passwordless) account → there is no password to reset.
    await sendEmail({
      to: email,
      subject: "Signing in to StudyPlan",
      text:
        `Hi ${firstName(user.fullName)},\n\n` +
        `Someone asked to reset the password for this email on StudyPlan. This account ` +
        `doesn't use a password — you sign in with "Continue with Google".\n\n` +
        `Go to ${base}/login and choose "Continue with Google".\n\n` +
        `If this wasn't you, no action is needed.`,
    });
  }
  // No account → send nothing. The HTTP response is identical in every branch.

  return NextResponse.json({ ok: true });
}
