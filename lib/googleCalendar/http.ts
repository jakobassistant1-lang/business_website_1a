// Tiny fetch wrapper with a hard timeout, shared by the Google auth + client
// layers so a hung Google endpoint can't stall a request indefinitely. Kept
// INSIDE the googleCalendar module on purpose — it does not import the app's
// Canvas fetch helper, so the integration stays fully isolated.

const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
