import { randomBytes, createHash } from "crypto";
import { prisma } from "./prisma";

// "Forgot password" tokens. The raw token is emailed inside the reset link; only
// its sha256 hash is stored in the DB, so a database leak can't be replayed to
// reset anyone's password. Tokens are single-use (usedAt) and expire after 1 hour.

export const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Mint a fresh reset token for a user. Clears the user's prior unused tokens
 * (only the newest link should ever work), stores the HASH, and returns the RAW
 * token for the emailed link. The raw token is never persisted.
 */
export async function createResetToken(userId: number): Promise<string> {
  await prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
  const raw = randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: { tokenHash: hashToken(raw), userId, expiresAt: new Date(Date.now() + RESET_TTL_MS) },
  });
  return raw;
}

/**
 * Validate and consume a raw reset token. Returns the userId on success, or null
 * if the token is unknown / expired / already used. The claim is atomic: the
 * updateMany only flips usedAt when the row is still unused AND unexpired, so two
 * concurrent submissions can't both succeed.
 */
export async function consumeToken(raw: string): Promise<number | null> {
  if (!raw) return null;
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!row) return null;
  const claimed = await prisma.passwordResetToken.updateMany({
    where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  return row.userId;
}
