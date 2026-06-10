import { redirect } from "next/navigation";

// Home now lands on the calm Dashboard; Calendar + Timeline are the detailed
// drill-down tools it links into.
export default function HomePage() {
  redirect("/dashboard");
}
