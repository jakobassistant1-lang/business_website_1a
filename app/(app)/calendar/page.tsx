import { redirect } from "next/navigation";

// Calendar folded into the unified Plan surface; keep the old path as a redirect
// so existing bookmarks/links still land somewhere sensible.
export default function CalendarPage() {
  redirect("/plan");
}
