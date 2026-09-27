// Shared size limits (pure, dependency-free — safe to import from sync and from
// the sanitizer without pulling either one's dependencies into the other).

/** Max characters of a Canvas assignment brief we store (lib/sync) and sanitize
 *  (lib/sanitizeBrief). Real briefs are a few KB; this bounds parser CPU/memory
 *  on pathological input (#131 security review). */
export const MAX_BRIEF_CHARS = 200_000;
