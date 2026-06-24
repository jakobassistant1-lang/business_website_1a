// Reset an existing account's password from the CLI (e.g. a forgotten test login).
// Usage:
//   node scripts/reset-password.mjs <email> <new-password>
// The new password is bcrypt-hashed before storage, same as create-user.mjs.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const [, , emailArg, passwordArg] = process.argv;

if (!emailArg || !passwordArg) {
  console.error("Usage: node scripts/reset-password.mjs <email> <new-password>");
  process.exit(1);
}
if (passwordArg.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();

const prisma = new PrismaClient();
try {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    console.error(`No user with email ${email}.`);
    process.exit(1);
  }
  const user = await prisma.user.update({
    where: { email },
    data: { password: await bcrypt.hash(passwordArg, 12) },
  });
  console.log(`Password reset for ${user.email} (id ${user.id}).`);
} finally {
  await prisma.$disconnect();
}
