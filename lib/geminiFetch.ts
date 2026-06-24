// Shared POST-to-Gemini with a per-attempt timeout and backoff retries on TRANSIENT
// failures — 429 (rate limit) and 503 ("model is currently experiencing high
// demand"). Both lib/analysis (the actionable screen + effort) and lib/latePolicy
// use it, so a transient Gemini blip no longer silently no-ops the analysis and
// leaves the user un-screened. Retries 429/503 AND transient network errors; only a
// per-attempt TIMEOUT is terminal (so we never stack multiple multi-second hangs).

const RETRYABLE_STATUS = new Set([429, 503]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Single source of truth for the model endpoint + key resolver (was copied across
// analysis / latePolicy / briefing / study). A model bump happens in one place now.
export const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

/** The server-only Gemini API key, tolerating a mis-cased env var name (e.g. the
 *  Vercel dashboard's `Gemini_API_Key` vs the code's `GEMINI_API_KEY`). */
export function geminiKey(): string | undefined {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const hit = Object.entries(process.env).find(([k]) => k.toLowerCase() === "gemini_api_key");
  return hit?.[1] || undefined;
}

export interface GeminiPostResult {
  res: Response | null; // null ⇒ network error or timeout (see `timedOut`)
  timedOut: boolean;
}

export async function geminiPost(
  url: string,
  body: unknown,
  opts: { timeoutMs: number; attempts?: number; backoffMs?: number },
): Promise<GeminiPostResult> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const backoffMs = opts.backoffMs ?? 500;
  for (let i = 0; i < attempts; i++) {
    const last = i === attempts - 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // Success, a non-retryable error, or the last attempt → hand it back as-is.
      if (res.ok || !RETRYABLE_STATUS.has(res.status) || last) return { res, timedOut: false };
      await res.body?.cancel().catch(() => {}); // release the connection before retrying
    } catch (e) {
      // A per-attempt TIMEOUT (abort) is terminal — don't stack more multi-second hangs.
      if (e instanceof Error && e.name === "AbortError") return { res: null, timedOut: true };
      // A transient NETWORK error (ECONNRESET / "fetch failed" / DNS) is retryable,
      // same as a 429/503 — fall through to backoff unless we're out of attempts.
      if (last) return { res: null, timedOut: false };
    } finally {
      clearTimeout(timer);
    }
    await sleep(backoffMs * 2 ** i); // 500ms, 1s, 2s … before retrying a 429/503 or network blip
  }
  return { res: null, timedOut: false }; // unreachable: the loop always returns
}

/** Pull complete top-level `{…}` objects out of a (possibly truncated or garbled)
 *  JSON array string, parsing each independently. Lets a batch response that was cut
 *  off mid-array — or has one malformed item — keep its valid objects instead of
 *  `JSON.parse` throwing and discarding all of them. String-aware (ignores braces
 *  inside quotes); a trailing unbalanced object is simply skipped. */
export function salvageJsonObjects(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      if (depth > 0 && --depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* skip a malformed object */
        }
        start = -1;
      }
    }
  }
  return out;
}
