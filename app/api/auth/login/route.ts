import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { verifyPassword, DUMMY_HASH } from "@/lib/password";
import { isAdminUser } from "@/lib/admin";
import { rateLimit, peekRateLimit, ipOf } from "@/lib/rateLimit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Login throttle (#128), shared limiter in lib/rateLimit.ts (best-effort, per
// serverless instance). Counts FAILURES only, in two buckets: per IP (scripted
// stuffing from one place) and per lowercased email (distributed stuffing of one
// account). Both are checked BEFORE the compare and recorded only AFTER a
// failure, so a correct password always succeeds — a dorm behind one NAT can't
// lock itself out by logging in, and junk requests can't lock a real user out.
// The 429 body is the same for both buckets and is decided before the account
// is looked up, so it never reveals whether the email exists.
//   IP bucket    — skipped when the IP is "unknown" (no x-real-ip / x-forwarded-for,
//                  i.e. a non-Vercel host): only the per-email bucket applies there.
//   Email bucket — skipped for an empty/malformed email (those can't be an account).
const LOGIN_IP_LIMIT = { limit: 30, windowMs: 15 * 60_000 };
const LOGIN_EMAIL_LIMIT = { limit: 20, windowMs: 60 * 60_000 };

function tooMany(retryAfterSec: number) {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  return NextResponse.json(
    { error: `Too many attempts. Try again in ${minutes} minutes.` },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

// FR-2: login. Generic error on bad credentials (FR-2.3). Role-agnostic — the
// account's own isAdmin (or the ADMIN_EMAILS allowlist) decides admin access;
// we return it only so the client can land admins on the board.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  const ip = ipOf(req);
  const ipKey = ip === "unknown" ? null : ip;
  const emailKey = EMAIL_RE.test(email) ? email : null;

  if (ipKey) {
    const byIp = peekRateLimit("login:ip", ipKey, LOGIN_IP_LIMIT);
    if (!byIp.allowed) return tooMany(byIp.retryAfterSec);
  }
  if (emailKey) {
    const byEmail = peekRateLimit("login:email", emailKey, LOGIN_EMAIL_LIMIT);
    if (!byEmail.allowed) return tooMany(byEmail.retryAfterSec);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Constant-shape work either way: bcrypt runs against the stored hash, or
  // against a dummy hash when there is no account / no password (Google-only
  // accounts must use "Continue with Google"), so timing doesn't reveal which.
  const ok = await verifyPassword(password, user?.password ?? DUMMY_HASH);
  if (!user || !user.password || !ok) {
    if (ipKey) rateLimit("login:ip", ipKey, LOGIN_IP_LIMIT);
    if (emailKey) rateLimit("login:email", emailKey, LOGIN_EMAIL_LIMIT);
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }
  await createSession(user.id);
  return NextResponse.json({ ok: true, isAdmin: isAdminUser(user) });
}
