import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import {
  exchangeLoginCode,
  fetchGoogleProfile,
  findOrCreateGoogleUser,
  googleAuthOrigin,
  verifyLoginState,
} from "@/lib/googleAuth";

export const dynamic = "force-dynamic";

// GET — Google redirects here with ?code & ?state. Verify the CSRF state, exchange
// the code, look up/create the account by verified email, start a session, and land
// the user (admins on /admin, students on /). Any failure → back to /login?error=google.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = googleAuthOrigin(url.origin);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const jar = await cookies();
  const nonce = jar.get("g_login_state")?.value;
  jar.delete("g_login_state");

  if (oauthError || !code || !state || !nonce || !verifyLoginState(state, nonce)) {
    return NextResponse.redirect(`${base}/login?error=google`);
  }

  try {
    const accessToken = await exchangeLoginCode(code);
    const profile = await fetchGoogleProfile(accessToken);
    if (!profile) return NextResponse.redirect(`${base}/login?error=google`);
    if (!profile.emailVerified) return NextResponse.redirect(`${base}/login?error=google_unverified`);

    const user = await findOrCreateGoogleUser(profile);
    await createSession(user.id);
    return NextResponse.redirect(`${base}/${isAdminUser(user) ? "admin" : ""}`);
  } catch {
    return NextResponse.redirect(`${base}/login?error=google`);
  }
}
