// Pure, client-safe host helpers — no Node imports (no dns/net), so this can be
// bundled into client components (the school picker) AND reused server-side by the
// Canvas client. One normalizer, no drift between what the UI shows and what the
// API stores.

/** Strip scheme/path/trailing slash; return the bare lowercase host (FR-4.2). */
export function normalizeHost(input: string): string {
  let h = input.trim().replace(/^https?:\/\//i, "");
  h = h.split("/")[0].replace(/\/+$/, "");
  return h.toLowerCase();
}
