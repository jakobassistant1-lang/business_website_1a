import { redirect } from "next/navigation";
import { requirePageAccess } from "@/lib/access";

// Calendar folded into the unified Plan surface; keep the old path as a redirect
// so existing bookmarks/links still land somewhere sensible.
export default async function CalendarPage() {
  await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  redirect("/plan");
}
