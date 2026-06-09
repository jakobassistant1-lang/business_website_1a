import { redirect } from "next/navigation";

// The Plan page was retired in favor of the Calendar + Timeline views; its
// safety features (at-risk alerts, recommended order) are folded into both.
// Home now lands on the Calendar.
export default function HomePage() {
  redirect("/calendar");
}
