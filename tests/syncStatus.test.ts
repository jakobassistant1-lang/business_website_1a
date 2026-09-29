// #136 — ONE sync indicator. The pure state machine is behaviour-tested (every
// combination of inputs yields exactly one state, in the owner's priority), plus
// source guards that the Calendar header and the Dashboard both render it from
// useAutoSync and nothing else prints a second, disagreeing status.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { syncState, syncStateText, showsFreshness, type SyncInputs, type SyncState } from "@/components/SyncStatus";
import { MOUNT_FRESH_MS } from "@/lib/syncPolicy";

const NOW = Date.parse("2026-09-28T12:05:00.000Z");
const base: SyncInputs = { syncing: false, warning: null, connected: true, lastCheckedAt: "2026-09-28T12:00:00.000Z", stale: false };
const at = (p: Partial<SyncInputs>, now = NOW) => syncState({ ...base, ...p }, now);

describe("syncState — priority: syncing → error → not connected → never checked → reconnect → up to date / last checked", () => {
  it("each state on its own", () => {
    expect(at({})).toBe("fresh");
    expect(at({ stale: true })).toBe("reconnect");
    expect(at({ lastCheckedAt: null })).toBe("never");
    expect(at({ lastCheckedAt: undefined })).toBe("never");
    expect(at({ connected: false })).toBe("not_connected");
    expect(at({ warning: "Couldn't reach Canvas just now — showing the last good data." })).toBe("error");
    expect(at({ syncing: true })).toBe("syncing");
  });
  it("'Up to date' only while the last check is younger than the auto-sync threshold (lib/syncPolicy)", () => {
    const t = Date.parse(base.lastCheckedAt!);
    expect(at({}, t + MOUNT_FRESH_MS - 1)).toBe("fresh");
    expect(at({}, t + MOUNT_FRESH_MS)).toBe("aging");
    expect(syncStateText("aging", null)).toBe(""); // just "Last checked Canvas …", no claim
    expect(at({ lastCheckedAt: "garbage" })).toBe("aging");
  });
  it("a broken connection says Reconnect Canvas — not 'Out of date'", () => {
    expect(syncStateText("reconnect", null)).toBe("Reconnect Canvas");
  });
  it("syncing wins over everything — never 'Up to date' beside 'Checking Canvas…'", () => {
    expect(at({ syncing: true, warning: "x", stale: true, lastCheckedAt: null })).toBe("syncing");
    expect(syncStateText("syncing", null)).toBe("Checking Canvas…");
  });
  it("an error wins over the server's state — never 'Up to date' beside a warning", () => {
    expect(at({ warning: "x" })).toBe("error");
    expect(at({ warning: "x", stale: true, lastCheckedAt: null })).toBe("error");
  });
  it("not connected beats never-checked and reconnect; never-checked beats reconnect", () => {
    expect(at({ connected: false, lastCheckedAt: null, stale: true })).toBe("not_connected");
    expect(at({ lastCheckedAt: null, stale: true })).toBe("never");
  });
  it("the freshness line rides with error, reconnect, up to date and aging — not while checking", () => {
    expect((["error", "reconnect", "fresh", "aging"] as SyncState[]).every(showsFreshness)).toBe(true);
    expect((["syncing", "not_connected", "never"] as SyncState[]).some(showsFreshness)).toBe(false);
  });
  it("exactly one state for every combination of inputs", () => {
    const all = new Set<SyncState>();
    for (const syncing of [false, true])
      for (const warning of [null, "w"])
        for (const connected of [false, true])
          for (const lastCheckedAt of [null, base.lastCheckedAt])
            for (const stale of [false, true])
              for (const now of [NOW, NOW + MOUNT_FRESH_MS]) {
                const s = syncState({ syncing, warning, connected, lastCheckedAt, stale }, now);
                all.add(s);
                expect(typeof syncStateText(s, warning)).toBe("string");
              }
    expect([...all].sort()).toEqual(["aging", "error", "fresh", "never", "not_connected", "reconnect", "syncing"]);
  });
  it("the error state shows the sync's own warning text", () => {
    expect(syncStateText("error", "Couldn't refresh 2 courses from Canvas — showing the last good data.")).toContain("2 courses");
    expect(syncStateText("fresh", null)).toBe("Up to date");
  });
});

describe("wiring — one indicator on both surfaces, fed by useAutoSync", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const ui = read("components/SyncStatus.tsx");
  const hook = read("components/useAutoSync.ts");
  it("the freshness line uses the LocalRelativeTime pattern; the threshold is lib/syncPolicy's", () => {
    expect(ui).toMatch(/Last checked Canvas <LocalRelativeTime iso=/);
    expect(ui).toMatch(/import \{ MOUNT_FRESH_MS \} from "@\/lib\/syncPolicy"/);
    expect(ui).not.toMatch(/\b\d+\s*\*\s*60\s*\*\s*1000\b/); // no private copy of the threshold
  });
  it("the error state has a real Try again BUTTON; reconnect is a link to /connections; the region is always mounted", () => {
    expect(ui).toMatch(/<button[^>]*onClick=\{onRetry\}[^>]*>\s*Try again\s*<\/button>/);
    expect(ui).toMatch(/<Link href="\/connections"/);
    expect(ui).toMatch(/role="status" aria-live="polite"/);
  });
  it("quiet and neutral — never red", () => {
    expect(ui).not.toMatch(/danger/);
  });
  it("useAutoSync hands SyncStatus its inputs and starts in 'checking' when a mount sync will run", () => {
    expect(hook).toMatch(/status: SyncInputs/);
    expect(hook).toMatch(/lastCheckedAt: opts\.lastCheckedAt \?\? syncedAt/);
    expect(hook).toMatch(/useState\(\(\) => enabled && syncDecision\("mount"/); // the same rule, decided on first render
    expect(hook).toMatch(/useState\(syncOnMount\)/);
  });
  for (const f of ["components/CalendarView.tsx", "components/DashboardView.tsx"]) {
    it(`${f} renders ONE <SyncStatus> from useAutoSync and no second status`, () => {
      const src = read(f);
      expect(src.match(/<SyncStatus\b/g)?.length).toBe(1);
      expect(src).toMatch(/useAutoSync\(\{[^}]*lastCheckedAt[^}]*\}\)/);
      for (const old of ["statusPill", "Stale data", "Not synced yet", "Syncing…", "{syncWarning}"]) expect(src, old).not.toContain(old);
    });
  }
});
