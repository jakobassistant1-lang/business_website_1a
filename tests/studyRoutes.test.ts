// #140/#145 route-level inputs: the AI routes hand the model the brief and the
// due/today days in the STUDENT's Canvas zone (User.timeZone via lib/studentZone,
// read server-side — a client `tz` is ignored), and cache on those inputs. The
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
import { generateAssignmentPlan, generateStudyHub, buildStudyHubPrompt } from "@/lib/briefing";
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
let zone: string | null = "America/New_York";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  uid++;
  zone = "America/New_York";
  m(requireActiveUser).mockImplementation(async () => ({ id: uid, fullName: "Calvin Test", timeZone: zone }));
});
afterEach(() => vi.useRealTimers());

describe("GET /api/assignment/approach", () => {
  const row = (description: string | null, unlockAt: Date | null = null) => ({
    canvasId: 5,
    name: "Lab 3",
    pointsPossible: 50,
    dueAt: DUE,
    unlockAt,
    submissionType: "online_upload",
    description,
    course: { name: "2026F-01:Chem 101" },
  });
  beforeEach(() => m(generateAssignmentPlan).mockResolvedValue({ approach: "Start by…", steps: ["a"], source: "gemini" }));

  it("passes the brief as plain text (no tags, no Canvas sr-only text), the due instant and the student's zone", async () => {
    m(prisma.assignment.findUnique).mockResolvedValue(
      row('<p>Measure <b>three</b> solutions.</p><a href="https://x.test">Handout<span class="screenreader-only">Links to an external site.</span></a><script>x()</script>'),
    );
    await approachGET(new Request("http://x/api/assignment/approach?id=5&tz=Europe%2FBerlin")); // client tz ignored
    const input = m(generateAssignmentPlan).mock.calls[0][0];
    expect(input.brief).toBe("Measure three solutions. Handout");
    expect(input.dueAt).toEqual(DUE);
    expect(input.timeZone).toBe("America/New_York");
  });

  it("no Canvas zone on the user → the default student zone; no description → empty brief", async () => {
    zone = null;
    m(prisma.assignment.findUnique).mockResolvedValue(row(null));
    await approachGET(new Request("http://x/api/assignment/approach?id=5"));
    const input = m(generateAssignmentPlan).mock.calls[0][0];
    expect(input.brief).toBe("");
    expect(input.timeZone).toBe("America/New_York");
  });

  it("not open yet (unlockAt in the future) → no AI call, locked: true", async () => {
    m(prisma.assignment.findUnique).mockResolvedValue(row("<p>x</p>", new Date("2026-10-01T12:00:00Z")));
    const body = await (await approachGET(new Request("http://x/api/assignment/approach?id=5"))).json();
    expect(body).toMatchObject({ approach: null, steps: [], locked: true });
    expect(m(generateAssignmentPlan)).not.toHaveBeenCalled();
  });

  it("the cache key covers the brief and the student's zone", async () => {
    m(prisma.assignment.findUnique).mockResolvedValue(row("<p>Version one of the brief.</p>"));
    await approachGET(new Request("http://x/api/assignment/approach?id=5"));
    await approachGET(new Request("http://x/api/assignment/approach?id=5"));
    expect(m(generateAssignmentPlan)).toHaveBeenCalledTimes(1); // second call served from cache
    zone = "Europe/Berlin";
    await approachGET(new Request("http://x/api/assignment/approach?id=5"));
    expect(m(generateAssignmentPlan)).toHaveBeenCalledTimes(2); // new zone → new key
    m(prisma.assignment.findUnique).mockResolvedValue(row("<p>Version two of the brief.</p>"));
    await approachGET(new Request("http://x/api/assignment/approach?id=5"));
    expect(m(generateAssignmentPlan)).toHaveBeenCalledTimes(3); // new brief → new key
  });
});

describe("GET /api/study-summary", () => {
  it("items keep the importance order; day counts and due dates are read in the student's zone", async () => {
    m(loadCalendarData).mockResolvedValue({});
    m(upcomingAssessments).mockReturnValue([
      { canvasId: 1, name: "Quiz 4", courseName: "2026F-01:MICROECONOMICS", type: "quiz", dueAt: DUE.toISOString(), pointsPossible: 20 },
      { canvasId: 2, name: "Midterm", courseName: "Macro", type: "exam", dueAt: null, pointsPossible: null },
    ]);
    m(generateStudyHub).mockResolvedValue({ ok: true, text: "x", source: "gemini" });
    await summaryGET();
    const input = m(generateStudyHub).mock.calls[0][0];
    expect(input.timeZone).toBe("America/New_York");
    expect(input.top.map((t: { name: string }) => t.name)).toEqual(["Quiz 4", "Midterm"]);
    const p = buildStudyHubPrompt(input);
    expect(p).toContain("Today is Sunday, Sep 27.");
    expect(p).toContain("1. Quiz 4 (MICROECONOMICS) [Quiz] — due Mon, Oct 12 · 11:59 PM (in 15 days), 20 pts");
    expect(p).toContain("2. Midterm (Macro) [Exam]\n"); // no due date → nothing about it

    zone = "UTC";
    await summaryGET();
    const utc = m(generateStudyHub).mock.calls[1][0]; // different zone → not a cache hit
    expect(buildStudyHubPrompt(utc)).toContain("due Tue, Oct 13 · 3:59 AM (in 16 days)");
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

  it("the plan hash includes timing-v2, the zone, the within-3-days flag and the lead time", async () => {
    await post({ canvasId: 7, kind: "plan", tz: "Europe/Berlin" }); // client tz ignored
    const parts = m(studyHash).mock.calls.at(-1)![0] as unknown[];
    expect(parts).toContain("timing-v2");
    expect(parts).toContain("America/New_York");
    expect(parts).not.toContain("Europe/Berlin");
    expect(parts).toContain("later"); // 15 days out
    expect(parts).toContain(3);
  });

  it("the prompt gets the student's zone, the lead time and the request's clock", async () => {
    await post({ canvasId: 7, kind: "plan" });
    const [meta, , , now] = m(generateStudyPlan).mock.calls[0];
    expect(meta).toMatchObject({ timeZone: "America/New_York", studyLeadDays: 3 });
    expect((now as Date).toISOString()).toBe(NOW.toISOString());
  });

  it("within 3 days flips the flag (so old plans regenerate)", async () => {
    vi.setSystemTime(new Date("2026-10-10T16:00:00Z"));
    await post({ canvasId: 7, kind: "plan" });
    const parts = m(studyHash).mock.calls.at(-1)![0] as unknown[];
    expect(parts).toContain("within3");
  });
});
