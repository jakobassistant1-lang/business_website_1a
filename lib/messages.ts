/** Any client fetch that never got an answer from Navo's server (offline, DNS, dropped). */
export const NETWORK_ERROR = "Couldn't reach Navo. Check your connection and try again.";

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
      return "We couldn't find Canvas at that address. Check it and try again (e.g., school.instructure.com).";
    case "unreachable":
      return "Canvas isn't responding right now. Try again shortly.";
    case "insufficient_scope":
      return "Your token connected but can't read your courses and assignments. Create a new token in Canvas with full read access.";
    case "throttled":
      return "Canvas is busy right now (rate limit). Please try again in a minute.";
    case "error":
    default:
      return `Something went wrong checking Canvas${httpCode ? ` (HTTP ${httpCode})` : ""}. Try again.`;
  }
}
