"use client";

// Ticket #46 — the admin standup log: my entry for today (save or update) on top,
// then the day-by-day history for the whole team. Initial data comes from the
// server page; saves POST to /api/admin/standup and patch the list in place.
import { useEffect, useMemo, useState } from "react";
import { useLocalToday } from "./useLocalToday";
import { ymd } from "@/lib/calendarDates";
import {
  formatStandupDay,
  groupByDate,
  upsertEntryInList,
  STANDUP_MAX_CHARS,
  type StandupEntryDto,
} from "@/lib/standup";

type Me = { name: string; id: number };
type Status = { kind: "ok" | "error"; text: string } | null;

function mineFor(entries: readonly StandupEntryDto[], date: string, meId: number) {
  return entries.find((e) => e.date === date && e.authorId === meId) ?? null;
}

export function StandupLog({
  initialEntries,
  me,
  serverToday,
}: {
  initialEntries: StandupEntryDto[];
  me: Me;
  serverToday: string;
}) {
  const [entries, setEntries] = useState<StandupEntryDto[]>(initialEntries);
  // The local-day correction (server UTC → device day) is useLocalToday's job.
  // It settles once after mount; `rolledToday` only covers a tab left open past
  // midnight (re-checked on focus / tab return and at submit time).
  const localToday = useLocalToday(serverToday);
  const [rolledToday, setRolledToday] = useState<string | null>(null);
  const today = rolledToday ?? localToday;
  // The server's date can differ from the device's (US evening vs UTC), so the
  // date and Save/Update label render only after mount — no visible flip.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [yesterday, setYesterday] = useState("");
  const [todayText, setTodayText] = useState("");
  const [blockers, setBlockers] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  // Whenever the standup day changes (mount, local-day correction, midnight
  // rollover), refill the form from my entry for that day (or blank it).
  useEffect(() => {
    const mine = mineFor(entries, today, me.id);
    setYesterday(mine?.yesterday ?? "");
    setTodayText(mine?.today ?? "");
    setBlockers(mine?.blockers ?? "");
    // Only the day drives a refill — a save updates `entries` and must not clobber the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  // A tab left open past midnight: when it's focused / shown again, move to the new day.
  useEffect(() => {
    function check() {
      if (document.visibilityState === "hidden") return;
      const now = ymd(new Date());
      if (now !== today) {
        setRolledToday(now);
        setStatus({ kind: "ok", text: "It's a new day — showing today's standup." });
      }
    }
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [today]);

  const mine = mineFor(entries, today, me.id);
  const days = useMemo(() => groupByDate(entries), [entries]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // Re-check the day at submit: never write yesterday's entry from a stale tab.
    const now = ymd(new Date());
    if (now !== today) {
      setRolledToday(now);
      setStatus({ kind: "error", text: "It's a new day — the form now shows today's standup. Check it and save again." });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/standup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: today, yesterday, today: todayText, blockers }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.entry) {
        setStatus({ kind: "error", text: body.error ?? "Couldn't save your standup. Try again." });
        return;
      }
      const saved = body.entry as StandupEntryDto;
      setEntries((list) => upsertEntryInList(list, saved));
      setYesterday(saved.yesterday);
      setTodayText(saved.today);
      setBlockers(saved.blockers ?? "");
      setStatus({ kind: "ok", text: mine ? "Standup updated." : "Standup saved." });
    } catch {
      setStatus({ kind: "error", text: "Couldn't reach the server. Try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl min-w-0">
      <h1 className="text-2xl font-semibold tracking-tight">Standup</h1>
      <p className="mt-1 text-sm text-muted">Daily log for the team — what you did, what&apos;s next, what&apos;s in the way.</p>

      <form onSubmit={save} className="card mt-6 min-w-0 p-4 md:p-5">
        <h2 className="text-lg font-semibold break-words">
          Today&apos;s standup —{" "}
          {mounted ? formatStandupDay(today) : <span className="inline-block h-5 w-40 max-w-full animate-pulse rounded bg-surface-soft align-middle" aria-hidden="true" />}
        </h2>
        <p className="mt-0.5 text-sm text-muted break-words">Posting as {me.name}</p>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="standup-yesterday" className="label">Yesterday</label>
            <textarea
              id="standup-yesterday"
              className="field min-h-24 resize-y"
              value={yesterday}
              maxLength={STANDUP_MAX_CHARS}
              onChange={(e) => setYesterday(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="standup-today" className="label">Today</label>
            <textarea
              id="standup-today"
              className="field min-h-24 resize-y"
              value={todayText}
              maxLength={STANDUP_MAX_CHARS}
              onChange={(e) => setTodayText(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="standup-blockers" className="label">Blockers (optional)</label>
            <textarea
              id="standup-blockers"
              className="field min-h-20 resize-y"
              value={blockers}
              maxLength={STANDUP_MAX_CHARS}
              onChange={(e) => setBlockers(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary max-md:tap" disabled={saving || !mounted}>
            {saving ? "Saving…" : mounted && mine ? "Update" : "Save"}
          </button>
          <p role="status" aria-live="polite" className={`min-w-0 text-sm break-words ${status?.kind === "error" ? "text-danger" : "text-success"}`}>
            {status?.text ?? ""}
          </p>
        </div>
      </form>

      <section className="mt-10 min-w-0" aria-labelledby="standup-history">
        <h2 id="standup-history" className="text-lg font-semibold">History</h2>
        {days.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No entries yet</p>
        ) : (
          <div className="mt-3 space-y-4">
            {days.map((day) => (
              <article key={day.date} className="card min-w-0 p-4 md:p-5">
                <h3 className="text-sm font-semibold text-muted">{formatStandupDay(day.date)}</h3>
                <div className="mt-3 space-y-4 divide-y divide-line-subtle">
                  {day.entries.map((e) => (
                    <div key={e.id} className="min-w-0 pt-4 first:pt-0">
                      <p className="font-medium break-words">{e.author}</p>
                      <dl className="mt-2 space-y-2 text-sm">
                        <Field label="Yesterday" value={e.yesterday} />
                        <Field label="Today" value={e.today} />
                        {e.blockers && <Field label="Blockers" value={e.blockers} />}
                      </dl>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-ink">{value}</dd>
    </div>
  );
}
