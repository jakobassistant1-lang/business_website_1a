// THE shared wordings (owner canon #146): one sentence per state, imported
// everywhere that state is shown — never a local copy.

/** Any client fetch that never got an answer from Navo's server (offline, DNS, dropped). */
export const NETWORK_ERROR = "Couldn’t reach Navo. Check your connection and try again.";

/** Navo's server answered but failed (HTTP 5xx, crashed route). Never blames the
 *  student's connection — that's NETWORK_ERROR's job. */
export const SERVER_ERROR = "Navo couldn’t finish that. Try again.";

/** The price when Stripe can't be read — the ONE fallback on every surface that
 *  only describes the price (signup terms, canceled page, trial-ending email).
 *  Never a number. The card page never uses it: no form without a real price. */
export const PRICE_FALLBACK = "a monthly fee";

/** The card step when Stripe's price can't be read: no payment form is shown
 *  without a real price beside it (/welcome/card offers a retry instead). */
export const PRICE_UNAVAILABLE = "We couldn’t load the price. Try again.";

/** A LATER Canvas check that refreshed no course at all; the cached plan from
 *  the previous check stays on screen. */
export const CANVAS_CHECK_FAILED = "Couldn’t reach Canvas just now — showing the last good data.";

/** The FIRST Canvas check failed: there is no "last good data" to show. */
export const CANVAS_FIRST_CHECK_FAILED = "Navo couldn’t read your courses from Canvas. Try again.";

/** Which of the two, by whether a previous Canvas check exists. */
export function canvasCheckFailed(hasPreviousCheck: boolean): string {
  return hasPreviousCheck ? CANVAS_CHECK_FAILED : CANVAS_FIRST_CHECK_FAILED;
}

/** Signup without ticking Terms — the ONE wording for the client check and the server's 400. */
export const TOS_REQUIRED = "Tick the box to agree to the Terms of Service and Privacy Policy.";

export type CanvasStatus =
  | "valid"
  | "invalid_token"
  | "bad_domain"
  | "unreachable"
  | "insufficient_scope"
  | "throttled" // Canvas rate limit (403 "Rate Limit Exceeded" / 429) — transient, never a token problem
  | "error";

/** User-visible messages per the FR-5 failure matrix. */
export function messageFor(status: CanvasStatus, httpCode?: number): string {
  switch (status) {
    case "valid":
      return "Connected.";
    case "invalid_token":
      return "Your Canvas token was rejected. Generate a new token in Canvas and re-enter it.";
    case "bad_domain":
      return "We couldn’t find Canvas at that address. Check it and try again (e.g., school.instructure.com).";
    case "unreachable":
      return "Canvas isn’t responding right now. Try again shortly.";
    case "insufficient_scope":
      return "Your token connected but can’t read your courses and assignments. Create a new token in Canvas with full read access.";
    case "throttled":
      return "Canvas is busy right now (rate limit). Please try again in a minute.";
    case "error":
    default:
      return `Something went wrong checking Canvas${httpCode ? ` (HTTP ${httpCode})` : ""}. Try again.`;
  }
}
