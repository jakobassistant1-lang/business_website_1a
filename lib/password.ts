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

// A real cost-12 bcrypt hash of a discarded random string. The login route
// compares against it when the email has no account (or no password) so a
// failed login costs the same bcrypt work whether or not the account exists —
// no timing-based email enumeration. It never matches any input.
export const DUMMY_HASH = "$2a$12$b5RXrisREfdJIP7JQpCfvu7ccmCmmcV.g2jSbhrqVi3sJ/UXnlB0q";
