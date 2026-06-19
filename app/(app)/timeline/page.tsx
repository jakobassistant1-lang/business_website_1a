import { redirect } from "next/navigation";

// Timeline folded into the unified Plan surface; keep the old path as a redirect
// so existing bookmarks/links still land somewhere sensible.
export default function TimelinePage() {
  redirect("/plan");
}
