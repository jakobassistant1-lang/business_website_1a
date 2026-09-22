import { redirect } from "next/navigation";
import { requirePageAccess } from "@/lib/access";

// Timeline folded into the unified Plan surface; keep the old path as a redirect
// so existing bookmarks/links still land somewhere sensible.
export default async function TimelinePage() {
  await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  redirect("/plan");
}
