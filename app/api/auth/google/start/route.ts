import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { buildLoginAuthUrl, googleAuthOrigin, isGoogleAuthConfigured, signLoginState } from "@/lib/googleAuth";

export const dynamic = "force-dynamic";

// GET — start "Sign in with Google": drop a CSRF nonce cookie, redirect to Google.
// No session required (this is how you log in). The button is only shown when the
// login client is configured, but guard here too in case it's hit directly.
export async function GET(req: Request) {
  const base = googleAuthOrigin(new URL(req.url).origin);
  if (!isGoogleAuthConfigured()) return NextResponse.redirect(`${base}/login?google=unconfigured`);

  const nonce = randomBytes(16).toString("hex");
  const state = signLoginState(nonce);
  const jar = await cookies();
  jar.set("g_login_state", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(buildLoginAuthUrl(state));
}
