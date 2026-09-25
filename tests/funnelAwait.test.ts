// #111 follow-up: funnel writes (and the email senders that log their own funnel
// event) must never be fire-and-forget in server code. On Vercel the function is
// frozen as soon as the response is returned, so a `void logEvent(...)` insert
// that hasn't landed yet is silently lost. `logEvent` and both senders never
// throw, so awaiting them is safe. Grep-guard, no runtime.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const serverFiles = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))];
const routeFiles = walk(join(ROOT, "app", "api")).filter((f) => /[\\/]route\.ts$/.test(f));
const rel = (f: string) => relative(ROOT, f);

describe("funnel writes are awaited, never fire-and-forget (#111)", () => {
  it("scans a real tree", () => {
    expect(serverFiles.length).toBeGreaterThan(20);
    expect(routeFiles.length).toBeGreaterThan(5);
  });

  it("no file under app/ or lib/ voids logEvent or an email sender", () => {
    const offenders = serverFiles.filter((f) =>
      /\bvoid\s+(logEvent|sendWelcomeEmail|sendTrialEndingEmail)\(/.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("every logEvent( call in app/api/**/route.ts is preceded by `await `", () => {
    const bad: string[] = [];
    let calls = 0;
    for (const f of routeFiles) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(import|\/\/|\*)/.test(line)) return;
        for (const m of line.matchAll(/\blogEvent\(/g)) {
          calls++;
          if (!/\bawait\s+$/.test(line.slice(0, m.index))) bad.push(`${rel(f)}:${i + 1}`);
        }
      });
    }
    expect(calls).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});
