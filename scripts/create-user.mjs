// Create an account from the CLI (for the locked-signup deployment).
// Usage:
//   node scripts/create-user.mjs <email> <password> "<Full Name>" [--admin]
// Honors ADMIN_EMAILS (a matching email is created as admin even without --admin).
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const [, , emailArg, passwordArg, ...rest] = process.argv;
const forceAdmin = rest.includes("--admin");
const fullName = rest.filter((a) => a !== "--admin").join(" ").trim() || "User";

if (!emailArg || !passwordArg) {
  console.error('Usage: node scripts/create-user.mjs <email> <password> "<Full Name>" [--admin]');
  process.exit(1);
}
if (passwordArg.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const isAdmin = forceAdmin || adminEmails.includes(email);

const prisma = new PrismaClient();
try {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.error(`User ${email} already exists (id ${existing.id}).`);
    process.exit(1);
  }
  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(passwordArg, 12),
      fullName,
      tosAcceptedAt: new Date(),
      isAdmin,
    },
  });
  console.log(`Created user ${user.email} (id ${user.id})${isAdmin ? " [admin]" : ""}.`);
} finally {
  await prisma.$disconnect();
}
