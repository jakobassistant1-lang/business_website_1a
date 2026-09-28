// #140 route-level inputs: the three AI routes hand the model the brief and the
// due/today days in the VIEWER's zone (not UTC), and cache on those inputs. The
// Gemini calls are mocked — these tests look only at what the routes pass in.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/access", () => ({ requireActiveUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    assignment: { findUnique: vi.fn(), findFirst: vi.fn() },
    studyGeneration: { findUnique: vi.fn(), upsert: vi.fn() },
    setting: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/calendarData", () => ({ loadCalendarData: vi.fn(), upcomingAssessments: vi.fn() }));
vi.mock("@/lib/briefing", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/briefing")>();
  return { ...real, generateAssignmentPlan: vi.fn(), generateStudyHub: vi.fn() };
});
vi.mock("@/lib/study", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/study")>();
  return { ...real, generateStudyPlan: vi.fn(), studyHash: vi.fn(real.studyHash) };
});

import { requireActiveUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { loadCalendarData, upcomingAssessments } from "@/lib/calendarData";
import { generateAssignmentPlan, generateStudyHub, safeTimeZone } from "@/lib/briefing";
import { generateStudyPlan, studyHash } from "@/lib/study";
import { GET as approachGET } from "@/app/api/assignment/approach/route";
import { GET as summaryGET } from "@/app/api/study-summary/route";
import { POST as studyPOST } from "@/app/api/study/route";

type Fn = ReturnType<typeof vi.fn>;
const m = (f: unknown) => f as Fn;

// 11:59 PM Oct 12 in New York = 03:59 UTC Oct 13. "Now" = noon Sep 27 in New York.
const DUE = new Date("2026-10-13T03:59:00Z");
const NOW = new Date("2026-09-27T16:00:00Z");
let uid = 1000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  uid++;
  m(requireActiveUser).mockResolvedValue({ id: uid, fullName: "Calvin Test" });
});
afterEach(() => vi.useRealTimers());

describe("safeTimeZone", () => {
  it("keeps a real IANA zone, falls back to UTC for junk", () => {
    expect(safeTimeZone("America/New_York")).toBe("America/New_York");
    for (const bad of [undefined, null, "", "Not/AZone", 42, "x".repeat(200)]) expect(safeTimeZone(bad)).toBe("UTC");
  });
});

describe("GET /api/assignment/approach", () => {
  const row = (description: string | null) => ({
    canvasId: 5,
    name: "Lab 3",
    pointsPossible: 50,
    dueAt: DUE,
    submissionType: "online_upload",
    description,
    course: { name: "Chem 101" },
  });
  beforeEach(() => m(generateAssignmentPlan).mockResolvedValue({ approach: "Start by…", steps: ["a"], source: "gemini" }));

  it("passes the brief as plain text (no tags, no Canvas sr-only text) and the zone-correct due day", async () => {
    m(prisma.assignment.findUnique).mockResolvedValue(
      row('<p>Measure <b>three</b> solutions.</p><a href="https://x.test">Handout<span class="screenreader-only">Links to an external site.</span></a><script>x()</script>'),
    );
    await approachGET(new Request("http://x/api/assignment/approach?id=5&tz=America%2FNew_York"));
    const input = m(generateAssignmentPlan).mock.calls[0][0];
    expect(input.brief).toBe("Measure three solutions. Handout");
    expect(input.dueLabel).toBe("2026-10-12"); // not UTC's 2026-10-13
    expect(input.todayYmd).toBe("2026-09-27");
  });

  it("no tz → UTC fallback; no description → empty brief (the prompt then says it's guessing)", async () => {
    m(prisma.assignment.findUnique).mockResolvedValue(row(null));
    await approachGET(new Request("http://x/api/assignment/approach?id=5"));
    const input = m(generateAssignmentPlan).mock.calls[0][0];
    expect(input.brief).toBe("");
    expect(input.dueLabel).toBe("2026-10-13");
  });

  it("the cache key covers the brief and the zone", async () => {
    m(prisma.assignment.findUnique).mockResolvedValue(row("<p>Version one of the brief.</p>"));
    await approachGET(new Request("http://x/api/assignment/approach?id=5&tz=America%2FNew_York"));
    await approachGET(new Request("http://x/api/assignment/approach?id=5&tz=America%2FNew_York"));
    expect(m(generateAssignmentPlan)).toHaveBeenCalledTimes(1); // second call served from cache
    await approachGET(new Request("http://x/api/assignment/approach?id=5&tz=Europe%2FBerlin"));
    expect(m(generateAssignmentPlan)).toHaveBeenCalledTimes(2); // new zone → new key
    m(prisma.assignment.findUnique).mockResolvedValue(row("<p>Version two of the brief.</p>"));
    await approachGET(new Request("http://x/api/assignment/approach?id=5&tz=Europe%2FBerlin"));
    expect(m(generateAssignmentPlan)).toHaveBeenCalledTimes(3); // new brief → new key
  });
});

describe("GET /api/study-summary", () => {
  it("day counts and due dates are read in the viewer's zone (ymdInZone)", async () => {
    m(loadCalendarData).mockResolvedValue({});
    m(upcomingAssessments).mockReturnValue([{ canvasId: 1, name: "Quiz 4", courseName: "Micro", type: "quiz", dueAt: DUE.toISOString() }]);
    m(generateStudyHub).mockResolvedValue({ ok: true, text: "x", source: "gemini" });
    await summaryGET(new Request("http://x/api/study-summary?tz=America%2FNew_York"));
    const input = m(generateStudyHub).mock.calls[0][0];
    expect(input.todayYmd).toBe("2026-09-27");
    expect(input.top[0]).toMatchObject({ dueLabel: "in 15 days", dueYmd: "2026-10-12" });

    await summaryGET(new Request("http://x/api/study-summary?tz=UTC"));
    const utc = m(generateStudyHub).mock.calls[1][0];
    expect(utc.top[0]).toMatchObject({ dueLabel: "in 16 days", dueYmd: "2026-10-13" }); // different input → not a cache hit
  });
});

describe("POST /api/study (plan)", () => {
  const post = (body: unknown) => studyPOST(new Request("http://x/api/study", { method: "POST", body: JSON.stringify(body) }));
  beforeEach(() => {
    m(prisma.assignment.findFirst).mockResolvedValue({
      canvasId: 7, name: "Quiz 4", submissionType: "online_quiz", dueAt: DUE, pointsPossible: 20, description: null, aiSummary: null,
      course: { name: "Micro", canvasId: 3 },
    });
    m(prisma.studyGeneration.findUnique).mockResolvedValue(null);
    m(prisma.setting.findUnique).mockResolvedValue(null);
    m(prisma.studyGeneration.upsert).mockResolvedValue({ updatedAt: NOW });
    m(loadCalendarData).mockResolvedValue({ plan: { days: [] }, items: [{ canvasId: 7, studyLeadDays: 3 }] });
    m(generateStudyPlan).mockResolvedValue({ ok: true, content: { advice: "x", sessions: [] } });
  });

  it("the plan hash includes timing-v1, the zone, the within-3-days flag and the lead time", async () => {
    await post({ canvasId: 7, kind: "plan", tz: "America/New_York" });
    const parts = m(studyHash).mock.calls.at(-1)![0] as unknown[];
    expect(parts).toContain("timing-v1");
    expect(parts).toContain("America/New_York");
    expect(parts).toContain("later"); // 15 days out
    expect(parts).toContain(3);
  });

  it("the prompt gets the zone, the lead time and today in that zone", async () => {
    await post({ canvasId: 7, kind: "plan", tz: "America/New_York" });
    const [meta, , , today] = m(generateStudyPlan).mock.calls[0];
    expect(meta).toMatchObject({ timeZone: "America/New_York", studyLeadDays: 3 });
    expect(today).toBe("2026-09-27");
  });

  it("an invalid zone falls back to UTC; within 3 days flips the flag (so old plans regenerate)", async () => {
    vi.setSystemTime(new Date("2026-10-10T16:00:00Z"));
    await post({ canvasId: 7, kind: "plan", tz: "Not/AZone" });
    const parts = m(studyHash).mock.calls.at(-1)![0] as unknown[];
    expect(parts).toContain("UTC");
    expect(parts).toContain("within3");
  });
});
