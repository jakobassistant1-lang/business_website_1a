import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { appOrigin } from "@/lib/appUrl";
import { rateLimit } from "@/lib/rateLimit";
import { TRIAL_DAYS } from "@/lib/subscription";
import { welcomeEmail, firstNameOf, type BuiltEmail } from "@/lib/welcomeEmail";
import { trialEndingEmail, trialEndingPrice } from "@/lib/trialEndingEmail";

export const dynamic = "force-dynamic";

// Self-service preview of a transactional email, sent through the REAL provider
// (Resend) with the production template — so the owner can see exactly what a
// student receives without Resend keys on a dev machine. It always goes to the
// signed-in user's OWN address: the recipient is never read from the request, so
// this can't be used as an open relay. Plain requireUser (allowlisted in
// tests/accessGating.test.ts): a blocked user may still preview to their own inbox.
// No funnel event — a preview is not a real welcome.
//
// Templates: "welcome" (#50) and "trial_ending" (#121). The trial-ending preview
// uses the previewer's own trialEndsAt when set, else now + TRIAL_DAYS, and the
// same Stripe price read (with the same neutral fallback) as the real send; the
// builder formats the cutoff (date + time + zone) exactly as the webhook send does.

type PreviewUser = { fullName: string | null; trialEndsAt?: Date | null };

const TEMPLATES: Record<string, (user: PreviewUser, origin: string) => BuiltEmail | Promise<BuiltEmail>> = {
  welcome: (user, origin) => welcomeEmail({ firstName: firstNameOf(user.fullName), appUrl: appOrigin(origin) }),
  trial_ending: async (user, origin) =>
    trialEndingEmail({
      firstName: firstNameOf(user.fullName),
      price: await trialEndingPrice(),
      trialEnd: user.trialEndsAt ?? new Date(Date.now() + TRIAL_DAYS * 86_400_000),
      appUrl: appOrigin(origin),
    }),
};

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const template = typeof body?.template === "string" ? body.template : "";
  const build = Object.hasOwn(TEMPLATES, template) ? TEMPLATES[template] : undefined;
  if (!build) return NextResponse.json({ error: "unknown_template" }, { status: 400 });

  const limited = rateLimit("email-preview", String(user.id), { limit: 3, windowMs: 60 * 60_000 });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many previews. Try again in an hour." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  const { subject, html, text } = await build(user, new URL(req.url).origin);
  const { ok } = await sendEmail({ to: user.email, subject, text, html });
  return NextResponse.json({ ok, to: user.email, subject });
}
