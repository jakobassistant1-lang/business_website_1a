import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { getSessionToken, requireUser } from "@/lib/auth";
import { appOrigin } from "@/lib/appUrl";
import { signState } from "@/lib/googleCalendar/auth"; // generic session-bound CSRF signer (reused)
import { isNotionConfigured, buildNotionAuthUrl } from "@/lib/notion";

export const dynamic = "force-dynamic";

// Only allow internal paths as the post-connect destination (no open redirect).
function safeReturn(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/connections";
}

// GET — start Notion OAuth: set a CSRF state cookie + remember where to return,
// then redirect to Notion's consent screen.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = appOrigin(url.origin);
  const user = await requireUser();
  if (!user) return NextResponse.redirect(`${base}/login`);
  if (!isNotionConfigured()) return NextResponse.redirect(`${base}/connections?notion=unconfigured`);

  const nonce = randomBytes(16).toString("hex");
  const state = signState(nonce, (await getSessionToken()) ?? "");
  const secure = process.env.NODE_ENV === "production";
  const jar = await cookies();
  jar.set("n_oauth_state", nonce, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600 });
  jar.set("n_oauth_return", safeReturn(url.searchParams.get("returnTo")), { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(buildNotionAuthUrl(state));
}
