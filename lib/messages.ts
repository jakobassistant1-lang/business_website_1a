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
      return "We couldn't reach a Canvas instance at that domain. Check the domain (e.g., school.instructure.com).";
    case "unreachable":
      return "Canvas isn't responding right now. Try again shortly.";
    case "insufficient_scope":
      return "Your token connected but lacks permission to read courses/assignments. Re-issue a token with full read access.";
    case "throttled":
      return "Canvas is busy right now (rate limit). Please try again in a minute.";
    case "error":
    default:
      return `Validation failed${httpCode ? ` (HTTP ${httpCode})` : ""}. Please retry.`;
  }
}
