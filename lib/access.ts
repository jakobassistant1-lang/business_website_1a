// Per-request access gate for API routes (#119). Lives here — not in lib/auth —
// because lib/admin already imports lib/auth (getCurrentUser); putting this in
// auth would create an import cycle auth → admin → auth.
//
// Access is decided on EVERY request from User.subscriptionStatus, never from
// the mere existence of a session (sessions are 1-year cookies with no server
// expiry). The rule itself is the pure `accessDecision` in lib/subscription.
import { redirect } from "next/navigation";
import { getCurrentUser } from "./auth";
import { isAdminUser } from "./admin";
import { accessDecision, billingEnabled, DECISION_PATH } from "./subscription";

/** For data API routes: the user iff they may use the app right now, else null
 *  (caller returns 401). Blocked users (past_due/canceled/unpaid) get null even
 *  though they're logged in. With BILLING_ENABLED unset this equals requireUser. */
export async function requireActiveUser() {
  const user = await getCurrentUser();
  if (!user) return null;
  return accessDecision(user, billingEnabled(), isAdminUser(user)) === "allow" ? user : null;
}

/** For every server page under app/(app): the gate, re-run PER PAGE. The (app)
 *  layout also gates, but Next 15 skips re-rendering a shared layout on client
 *  navigations whose segment still matches — so a user flipped to past_due /
 *  canceled would keep opening pages via <Link> until a hard load. Calling this
 *  as the first statement of each page closes that gap. Same cached user as the
 *  layout (no extra query); with the flag unset it returns the user immediately. */
export async function requirePageAccess() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const decision = accessDecision(user, billingEnabled(), isAdminUser(user));
  if (decision !== "allow") redirect(DECISION_PATH[decision]);
  return user;
}
