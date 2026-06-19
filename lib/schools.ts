import { normalizeHost } from "./host";
import rawSchools from "./schools.data.json";

export interface School {
  /** Official name shown in the dropdown. */
  name: string;
  /** Bare, normalized Canvas host, e.g. "bruinlearn.ucla.edu". */
  host: string;
  /** Short names a student might type (e.g. "UCLA"). */
  aliases?: string[];
}

interface RawSchool {
  name: string;
  canvasHost: string;
  aliases?: string[];
  region?: string;
  confidence?: string;
  source?: string;
}

// Curated, source-verified Canvas hosts (data: lib/schools.data.json). NOT
// exhaustive — the picker always offers a manual "enter your link" fallback. Every
// host is normalized so the deep link to /profile/settings is always well-formed.
export const SCHOOLS: School[] = (rawSchools as unknown as RawSchool[])
  .map((r) => ({ name: r.name, host: normalizeHost(r.canvasHost), aliases: r.aliases }))
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Filter schools by a query matched against name + aliases (with the host as a
 * fallback, e.g. typing "instructure"). Case-insensitive. Ranks prefix matches
 * above substring matches, then alphabetical. Returns at most `limit` results
 * (default 50) to cap render cost. `list` is injectable for tests.
 */
export function filterSchools(query: string, limit = 50, list: School[] = SCHOOLS): School[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, limit);

  const scored: { school: School; rank: number }[] = [];
  for (const s of list) {
    const haystacks = [s.name, ...(s.aliases ?? [])].map((x) => x.toLowerCase());
    let rank = Infinity;
    for (const h of haystacks) {
      const idx = h.indexOf(q);
      if (idx === 0) { rank = 0; break; }    // prefix beats everything
      if (idx > 0) rank = Math.min(rank, 1); // substring
    }
    if (rank === Infinity && s.host.includes(q)) rank = 2; // host fallback
    if (rank !== Infinity) scored.push({ school: s, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.school.name.localeCompare(b.school.name));
  return scored.slice(0, limit).map((x) => x.school);
}
