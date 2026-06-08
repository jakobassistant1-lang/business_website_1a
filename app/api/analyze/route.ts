import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { runAnalysis } from "@/lib/analysisStore";

export const dynamic = "force-dynamic";

// POST /api/analyze — analyze the user's un-analyzed assignments (effort + summary)
// and persist the results. Lazy + idempotent + fails open; called post-mount from
// the Plan page, never on the server render path. Returns counts only.
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await runAnalysis(user.id);
  return NextResponse.json(result);
}
