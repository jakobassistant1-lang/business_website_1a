// Refresh the sandbox test account's Canvas token (minted into /tmp by the rails
// step) and run a real sync, then verify the app DB density. The token value is
// read from the temp file, encrypted, stored, and the temp file deleted — never
// printed. Run: NODE_ENV=development npx tsx --env-file=.env scripts/_canvas-sync.ts
import { readFileSync, unlinkSync, existsSync } from "fs";
import { prisma } from "../lib/prisma";
import { encryptSecret } from "../lib/crypto";
import { runSync } from "../lib/sync";

const USER = 5;
const TOKEN_PATH = "/tmp/navo_sync_token.txt";

async function main() {
  if (!existsSync(TOKEN_PATH)) throw new Error(`token file missing: ${TOKEN_PATH}`);
  const token = readFileSync(TOKEN_PATH, "utf8").trim();
  if (!token) throw new Error("empty token file");

  await prisma.canvasCredential.update({
    where: { userId: USER },
    data: { token: encryptSecret(token), lastValidationStatus: "valid", lastValidatedAt: new Date() },
  });
  console.log("credential token refreshed; running sync...");

  const result = await runSync(USER);
  console.log("syncResult:", JSON.stringify(result));

  const courses = await prisma.course.count({ where: { userId: USER } });
  const assignments = await prisma.assignment.count({ where: { userId: USER } });
  const dated = await prisma.assignment.findMany({ where: { userId: USER, dueAt: { not: null } }, select: { dueAt: true } });

  const counts: Record<string, number> = {};
  for (const a of dated) {
    const key = a.dueAt!.toISOString().slice(0, 10);
    counts[key] = (counts[key] || 0) + 1;
  }
  const start = Date.UTC(2026, 5, 15); // Jun 15
  let withItem = 0, total = 0, min = Infinity, max = 0;
  for (let i = 0; i < 56; i++) {
    const key = new Date(start + i * 86400000).toISOString().slice(0, 10);
    const c = counts[key] || 0;
    if (c > 0) withItem++;
    total += c; min = Math.min(min, c); max = Math.max(max, c);
  }
  console.log(`app DB (user ${USER}): courses=${courses}, assignments=${assignments}`);
  console.log(`window Jun15-Aug9: ${total} dated items, ${(total / 56).toFixed(2)}/day, days>=1: ${withItem}/56, min=${min}, max=${max}`);

  unlinkSync(TOKEN_PATH);
  console.log("temp token file removed");
}
main().catch((e) => { console.error("SYNC FAILED:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
