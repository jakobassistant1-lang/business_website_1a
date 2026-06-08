import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { requireUser } from "@/lib/auth";
import { appOrigin, buildAuthUrl, isGoogleConfigured } from "@/lib/googleCalendar/auth";

export const dynamic = "force-dynamic";

// GET — start the OAuth flow: set a CSRF state cookie, redirect to Google.
export async function GET(req: Request) {
  const base = appOrigin(new URL(req.url).origin);
  const user = await requireUser();
  if (!user) return NextResponse.redirect(`${base}/login`);
  if (!isGoogleConfigured()) return NextResponse.redirect(`${base}/connections?google=unconfigured`);

  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("g_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(buildAuthUrl(state));
}
