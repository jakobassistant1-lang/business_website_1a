import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { getSessionToken, requireUser } from "@/lib/auth";
import { appOrigin, buildAuthUrl, isGoogleConfigured, signState } from "@/lib/googleCalendar/auth";

export const dynamic = "force-dynamic";

// GET — start the OAuth flow: set a CSRF state cookie, redirect to Google.
export async function GET(req: Request) {
  const base = appOrigin(new URL(req.url).origin);
  const user = await requireUser();
  if (!user) return NextResponse.redirect(`${base}/login`);
  if (!isGoogleConfigured()) return NextResponse.redirect(`${base}/connections?google=unconfigured`);

  // The cookie holds a random nonce (double-submit); the `state` param holds the
  // nonce signed against this session, so the callback can't be satisfied by a
  // code/state pair minted in a different session.
  const nonce = randomBytes(16).toString("hex");
  const state = signState(nonce, (await getSessionToken()) ?? "");
  const jar = await cookies();
  jar.set("g_oauth_state", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(buildAuthUrl(state));
}
