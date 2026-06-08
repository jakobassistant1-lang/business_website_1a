import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { appOrigin, exchangeCodeForTokens, fetchGoogleEmail } from "@/lib/googleCalendar/auth";
import { encryptSecret } from "@/lib/crypto";

export const dynamic = "force-dynamic";

// GET — Google redirects here with ?code & ?state. Verify CSRF state, exchange
// the code, store (encrypted) tokens, kick off an initial sync, return to /connections.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = appOrigin(url.origin);
  const user = await requireUser();
  if (!user) return NextResponse.redirect(`${base}/login`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const jar = await cookies();
  const expected = jar.get("g_oauth_state")?.value;
  jar.delete("g_oauth_state");

  if (oauthError || !code || !state || !expected || state !== expected) {
    return NextResponse.redirect(`${base}/connections?google=error`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const email = await fetchGoogleEmail(tokens.accessToken);
    await prisma.googleCalendarConnection.upsert({
      where: { userId: user.id },
      update: {
        // Only overwrite the stored email when userinfo actually returned one.
        ...(email ? { email } : {}),
        accessToken: encryptSecret(tokens.accessToken),
        ...(tokens.refreshToken ? { refreshToken: encryptSecret(tokens.refreshToken) } : {}),
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      },
      create: {
        userId: user.id,
        email,
        accessToken: encryptSecret(tokens.accessToken),
        refreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      },
    });
    // Don't sync inline — on a heavy calendar that can outlast the redirect.
    // The Connections card auto-syncs on mount (and offers a manual "Sync now").
    return NextResponse.redirect(`${base}/connections?google=connected`);
  } catch {
    return NextResponse.redirect(`${base}/connections?google=error`);
  }
}
