import bcrypt from "bcryptjs";

// Password hashing for the public deployment. bcryptjs is pure-JS (no native
// build step) so it works on Vercel's serverless runtime.
const ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
