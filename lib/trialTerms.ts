// What a new student is signing up to (#110), computed on the server so the
// client never hardcodes a price. One helper, called by BOTH auth pages
// (/signup and /login — the login page can switch to signup in place), so the
// two doors can never show different terms.
//
// Hard rule: /login and /signup must NEVER wait on Stripe. The price read is
// raced against a short timeout and falls back to null (the copy then drops the
// number), and a null result is remembered for a minute so a Stripe slowdown
// costs at most one 1.5s wait per server instance per minute.
import { billingEnabled, TRIAL_DAYS, type TrialTerms } from "./subscription";
import { priceDisplay } from "./stripe";

/** How long a door will wait for Stripe before giving up on the price. */
export const PRICE_TIMEOUT_MS = 1500;
/** How long a failed/slow price read suppresses the next attempt. */
export const PRICE_RETRY_AFTER_MS = 60_000;

/** Resolve `p`, or null if it rejects or outruns `ms`. The loser's timer is
 *  cleared so a fast success doesn't leave a pending handle behind. Generic and
 *  pure enough to unit-test with fake timers. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([p, timeout])
    .catch(() => null)
    .finally(() => clearTimeout(timer));
}

// ---- negative cache (module scope = per server instance) ----
// priceDisplay() already caches a SUCCESSFUL read forever; this is the missing
// other half — remembering that it did NOT work, so the next page view fails
// fast instead of burning another 1.5s.
let retryPriceAfter = 0;

/** Are we still inside the back-off window from the last null price read? */
export function priceFetchSuppressed(now: number): boolean {
  return now < retryPriceAfter;
}
/** Record a null price read; suppresses the next attempt for PRICE_RETRY_AFTER_MS. */
export function noteNullPrice(now: number): void {
  retryPriceAfter = now + PRICE_RETRY_AFTER_MS;
}
/** Clear the back-off (tests; also lets a deploy start clean). */
export function resetPriceBackoff(): void {
  retryPriceAfter = 0;
}

/** The price string for trial copy, or null — never throws, never waits long.
 *  Shared by the auth doors and the in-app TrialBanner so both degrade the same
 *  way. Exported for the banner; the back-off is deliberately shared. */
export async function loadTrialPrice(now: number = Date.now()): Promise<string | null> {
  if (priceFetchSuppressed(now)) return null;
  const price = await withTimeout(priceDisplay(), PRICE_TIMEOUT_MS);
  if (price === null) noteNullPrice(now);
  return price;
}

/** null when billing is off (prod today: BILLING_ENABLED unset) → no money copy
 *  renders at all. A null `price` inside means Stripe was unreachable, slow, or
 *  unconfigured — the copy then drops the number instead of inventing one.
 *  Never throws: the auth pages must render even if Stripe is down. */
export async function loadTrialTerms(): Promise<TrialTerms | null> {
  if (!billingEnabled()) return null;
  return { price: await loadTrialPrice(), trialDays: TRIAL_DAYS };
}
