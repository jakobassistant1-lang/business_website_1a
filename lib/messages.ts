export type CanvasStatus =
  | "valid"
  | "invalid_token"
  | "bad_domain"
  | "unreachable"
  | "insufficient_scope"
  | "error";

/** User-visible messages per the FR-5 failure matrix. Plain, grade-5 English —
 *  each ends with the one thing the student can do to fix it. */
export function messageFor(status: CanvasStatus, httpCode?: number): string {
  switch (status) {
    case "valid":
      return "Connected.";
    case "invalid_token":
      return "That code didn't work — it may be mistyped or expired. Make a new one in Canvas and paste it again.";
    case "bad_domain":
      return "We couldn't find Canvas at that web address. Check your school's address (it usually ends in .instructure.com).";
    case "unreachable":
      return "Canvas isn't answering right now. Wait a moment and try again.";
    case "insufficient_scope":
      return "We connected, but that code can't read your classes. Make a new one with full access and paste it again.";
    case "error":
    default:
      return "Something went wrong on our end. Please try again in a bit.";
  }
}
