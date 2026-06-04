import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";

/**
 * Admin permission model for the team Kanban board.
 *
 * A user is an admin if EITHER:
 *   1. their `isAdmin` column is true (explicit grant, scales to teammates), OR
 *   2. their email is in the ADMIN_EMAILS env allowlist (zero-friction
 *      bootstrap for the owner — no DB editing needed).
 *
 * Enforced server-side: the /admin route group via its layout, and every
 * /api/admin/* handler via withAdmin(). Non-admins get a 404 everywhere (page
 * and API) so the board's existence isn't revealed — never just a hidden link.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminUser(user: { email: string; isAdmin?: boolean } | null | undefined): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  return adminEmails().includes(user.email.toLowerCase());
}

/** Returns the current user iff they are an admin, else null. */
export async function getAdminUser() {
  const user = await getCurrentUser();
  return isAdminUser(user) ? user : null;
}

type AdminUser = NonNullable<Awaited<ReturnType<typeof getAdminUser>>>;

/**
 * Wraps an /api/admin/* route handler so the admin check happens once, before
 * the handler runs, and a non-admin uniformly gets a 404 (matching the page's
 * notFound()). New admin routes opt into protection by wrapping — there's no
 * per-handler check to forget or get subtly wrong.
 */
export function withAdmin<C>(
  handler: (admin: AdminUser, req: Request, ctx: C) => Promise<Response> | Response,
): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    const admin = await getAdminUser();
    if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return handler(admin, req, ctx);
  };
}
