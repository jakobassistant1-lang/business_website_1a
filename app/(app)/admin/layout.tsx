import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";

// Route-group gate: every /admin/* page is admin-only by default. Adding a new
// admin page under this folder is auto-protected — no per-page check to forget.
// Non-admins get a 404 (the section is invisible, not just blocked).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminUser();
  if (!admin) notFound();
  return <>{children}</>;
}
