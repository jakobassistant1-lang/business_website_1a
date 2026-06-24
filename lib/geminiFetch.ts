// Shared POST-to-Gemini with a per-attempt timeout and backoff retries on TRANSIENT
// failures — 429 (rate limit) and 503 ("model is currently experiencing high
// demand"). Both lib/analysis (the actionable screen + effort) and lib/latePolicy
// use it, so a transient Gemini blip no longer silently no-ops the analysis and
// leaves the user un-screened. Only retryable HTTP statuses retry; a timeout or
// network error returns immediately so we never stack multiple multi-second hangs.

const RETRYABLE_STATUS = new Set([429, 503]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      if (res.ok || !RETRYABLE_STATUS.has(res.status) || i === attempts - 1) return { res, timedOut: false };
    } catch (e) {
      // Timeout (abort) or network error: bail now rather than stack more hangs.
      return { res: null, timedOut: e instanceof Error && e.name === "AbortError" };
    } finally {
      clearTimeout(timer);
    }
    await sleep(backoffMs * 2 ** i); // 500ms, 1s, 2s … before retrying a 429/503
  }
  return { res: null, timedOut: false }; // unreachable: the loop always returns
}
