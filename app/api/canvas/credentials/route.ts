import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { normalizeHost, apiBase, validateCredentials } from "@/lib/canvas";
import { messageFor } from "@/lib/messages";
import { encryptSecret } from "@/lib/crypto";

// FR-4: read the saved connection + its last status (for initial page state).
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cred = await prisma.canvasCredential.findUnique({ where: { userId: user.id } });
  if (!cred) return NextResponse.json({ connected: false });

  return NextResponse.json({
    connected: true,
    host: cred.host,
    status: cred.lastValidationStatus,
    accountName: cred.accountName,
    lastValidatedAt: cred.lastValidatedAt,
    syncedAt: cred.syncedAt,
  });
}

// FR-4/FR-5: save credentials (overwrite single record), then validate.
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rawHost = String(body.host ?? "").trim();
  const token = String(body.token ?? "").trim();
  if (!rawHost || !token) {
    return NextResponse.json({ error: "Both the Canvas domain and a token are required." }, { status: 400 });
  }

  const host = normalizeHost(rawHost);
  const base = apiBase(host);

  // FR-4.4: validation runs before reporting success.
  const v = await validateCredentials(host, token);

  // FR-4.3: exactly one credential per user; saving overwrites it. Cache untouched.
  // Token is encrypted at rest (lib/crypto): scrambled when ENCRYPTION_KEY is set,
  // tagged-plaintext fallback otherwise. Readers decrypt via decryptSecret.
  const storedToken = encryptSecret(token);
  await prisma.canvasCredential.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      host,
      apiBase: base,
      token: storedToken,
      lastValidationStatus: v.status,
      lastValidatedAt: v.status === "valid" ? new Date() : null,
      accountName: v.accountName ?? null,
    },
    update: {
      host,
      apiBase: base,
      token: storedToken,
      lastValidationStatus: v.status,
      ...(v.status === "valid" ? { lastValidatedAt: new Date() } : {}),
      accountName: v.accountName ?? null,
    },
  });

  return NextResponse.json({
    status: v.status,
    accountName: v.accountName ?? null,
    message: messageFor(v.status, v.httpCode),
  });
}
