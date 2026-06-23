import { describe, it, expect } from "vitest";
import { BACKLOG, GOAL_ONBOARDING } from "@/lib/backlog";
import { ONBOARDING_BACKLOG } from "@/lib/onboardingBacklog";
import { TICKET_SIZES } from "@/lib/kanban";

// Guards the onboarding ticket data so a future edit can't slip in a duplicate or a
// number that collides with the build backlog (which would break the additive
// [board, ticketNumber] top-up in lib/onboardingSeed.ts).
describe("onboarding backlog data", () => {
  it("has unique ticket numbers", () => {
    const nums = ONBOARDING_BACKLOG.map((t) => t.number);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it("never collides with the build backlog numbers (101+ range)", () => {
    const build = new Set(BACKLOG.map((t) => t.number));
    for (const t of ONBOARDING_BACKLOG) {
      expect(build.has(t.number)).toBe(false);
      expect(t.number).toBeGreaterThanOrEqual(101);
    }
  });

  it("is grouped under the onboarding goal with a subgoal", () => {
    for (const t of ONBOARDING_BACKLOG) {
      expect(t.goal).toBe(GOAL_ONBOARDING);
      expect(t.subgoal.trim().length).toBeGreaterThan(0);
    }
  });

  it("has a valid size, backlog status, and the required text", () => {
    for (const t of ONBOARDING_BACKLOG) {
      expect(TICKET_SIZES as readonly string[]).toContain(t.size);
      expect(t.status).toBe("backlog");
      expect(t.title.trim().length).toBeGreaterThan(0);
      expect(t.scope.trim().length).toBeGreaterThan(0);
      expect(t.acceptance.trim().length).toBeGreaterThan(0);
    }
  });
});
