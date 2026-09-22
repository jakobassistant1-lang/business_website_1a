import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/access";
import { loadPlan } from "@/lib/plan";

// FR-9: generate the plan. Optional ?hours= override (FR-8).
export async function GET(req: Request) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const hoursParam = url.searchParams.get("hours");
  let hours: number | undefined;
  if (hoursParam !== null) {
    const h = Number(hoursParam);
    if (!Number.isFinite(h) || h <= 0 || h > 24) {
      return NextResponse.json({ error: "Hours must be greater than 0 and at most 24." }, { status: 400 });
    }
    hours = h;
  }

  const payload = await loadPlan(user.id, hours);
  return NextResponse.json(payload);
}
