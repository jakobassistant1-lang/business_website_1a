import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionToken, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { appOrigin } from "@/lib/appUrl";
import { verifyState } from "@/lib/googleCalendar/auth";
import { encryptSecret } from "@/lib/crypto";
import { exchangeNotionCode } from "@/lib/notion";

export const dynamic = "force-dynamic";

// GET — Notion redirects here with ?code & ?state. Verify CSRF state, exchange the
// code, store the (encrypted) token, return to where the student started.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = appOrigin(url.origin);
  const user = await requireUser();
  if (!user) return NextResponse.redirect(`${base}/login`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const jar = await cookies();
  const nonce = jar.get("n_oauth_state")?.value;
  const returnTo = jar.get("n_oauth_return")?.value || "/connections";
  jar.delete("n_oauth_state");
  jar.delete("n_oauth_return");
  const sep = returnTo.includes("?") ? "&" : "?";

  const sessionToken = (await getSessionToken()) ?? "";
  if (oauthError || !code || !state || !nonce || !verifyState(state, nonce, sessionToken)) {
    return NextResponse.redirect(`${base}${returnTo}${sep}notion=error`);
  }

  try {
    const tok = await exchangeNotionCode(code);
    if (!tok.accessToken) throw new Error("no_token");
    await prisma.notionConnection.upsert({
      where: { userId: user.id },
      update: { accessToken: encryptSecret(tok.accessToken), workspaceName: tok.workspaceName, workspaceId: tok.workspaceId, botId: tok.botId },
      create: {
        userId: user.id,
        accessToken: encryptSecret(tok.accessToken),
        workspaceName: tok.workspaceName,
        workspaceId: tok.workspaceId,
        botId: tok.botId,
      },
    });
    return NextResponse.redirect(`${base}${returnTo}${sep}notion=connected`);
  } catch {
    return NextResponse.redirect(`${base}${returnTo}${sep}notion=error`);
  }
}
