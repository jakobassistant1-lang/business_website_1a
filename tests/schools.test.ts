import { describe, it, expect } from "vitest";
import { filterSchools, type School } from "@/lib/schools";

const fixture: School[] = [
  { name: "Florida State University", host: "fsu.instructure.com", aliases: ["FSU"] },
  { name: "Miami Dade College", host: "mdc.instructure.com", aliases: ["MDC"] },
  { name: "University of California, Los Angeles", host: "bruinlearn.ucla.edu", aliases: ["UCLA"] },
  { name: "University of Florida", host: "ufl.instructure.com", aliases: ["UF", "Gators"] },
];

describe("filterSchools", () => {
  it("returns all results (capped) for an empty query", () => {
    expect(filterSchools("", 2, fixture)).toHaveLength(2);
    expect(filterSchools("   ", 50, fixture)).toHaveLength(fixture.length);
  });

  it("matches by name, case-insensitively", () => {
    const names = filterSchools("FLORIDA", 50, fixture).map((s) => s.name);
    expect(names).toContain("University of Florida");
    expect(names).toContain("Florida State University");
  });

  it("matches by alias", () => {
    const r = filterSchools("ucla", 50, fixture);
    expect(r[0].host).toBe("bruinlearn.ucla.edu");
  });

  it("ranks prefix matches above substring matches", () => {
    // "flor" is a prefix of "Florida State University" but only a substring of
    // "University of Florida", so FSU should sort first.
    const r = filterSchools("flor", 50, fixture);
    expect(r[0].name).toBe("Florida State University");
  });

  it("falls back to a host match (e.g. typing the LMS host)", () => {
    const r = filterSchools("instructure", 50, fixture);
    expect(r.length).toBeGreaterThanOrEqual(3); // the three *.instructure.com schools
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterSchools("zzzznotaschool", 50, fixture)).toEqual([]);
  });

  it("respects the limit", () => {
    expect(filterSchools("instructure", 1, fixture)).toHaveLength(1);
  });
});
