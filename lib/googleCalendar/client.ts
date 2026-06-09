// Google Calendar API client: produces a valid access token for a user
// (refreshing + persisting when expired) and performs authenticated calls.
// Server-only. Token values are decrypted only in memory here.

import { prisma } from "../prisma";
import { decryptSecret, encryptSecret } from "../crypto";
import { refreshAccessToken } from "./auth";
import { fetchWithTimeout } from "./http";
import { CalendarError } from "../calendar/types";

const SKEW_MS = 60_000; // refresh a minute before expiry
const API_BASE = "https://www.googleapis.com/calendar/v3";

/** Raw HTTP error from the Calendar API (carries the status for logging). The
 *  route maps anything that isn't a typed CalendarError to a generic failure. */
export class CalendarApiError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? `calendar_api_${status}`);
  }
}

/** A currently-valid access token, refreshing + persisting if the stored one
 *  has expired. Throws a typed CalendarError ("not_connected"/"token_expired"). */
export async function getValidAccessToken(userId: number): Promise<string> {
  const conn = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
  if (!conn || !conn.accessToken) throw new CalendarError("not_connected");

  try {
    const valid = conn.expiresAt && conn.expiresAt.getTime() - SKEW_MS > Date.now();
    if (valid) return decryptSecret(conn.accessToken);

    if (!conn.refreshToken) throw new CalendarError("token_expired");
    const refreshed = await refreshAccessToken(decryptSecret(conn.refreshToken));
    await prisma.googleCalendarConnection.update({
      where: { userId },
      data: {
        accessToken: encryptSecret(refreshed.accessToken),
        expiresAt: refreshed.expiresAt,
        ...(refreshed.scope ? { scope: refreshed.scope } : {}),
        // Google may rotate the refresh token — persist it so we don't keep using a dead one.
        ...(refreshed.refreshToken ? { refreshToken: encryptSecret(refreshed.refreshToken) } : {}),
      },
    });
    return refreshed.accessToken;
  } catch {
    // A dead refresh token (Google `invalid_grant` after revoke/expiry) or an
    // undecryptable token (ENCRYPTION_KEY changed) can't be recovered without
    // re-consent. Normalize to "token_expired" so the UI prompts a reconnect
    // instead of a vague "sync failed" the user would just retry forever.
    throw new CalendarError("token_expired");
  }
}

/** Authenticated GET against the Calendar API, with one auto-retry on 401. */
export async function calendarApiGet(userId: number, path: string): Promise<unknown> {
  // fetchWithTimeout bounds the request so a hung Google connection can't stall a sync forever.
  const doFetch = (token: string) =>
    fetchWithTimeout(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });

  let res = await doFetch(await getValidAccessToken(userId));
  if (res.status === 401) {
    // Token rejected — force a refresh (clear expiry) and retry once.
    await prisma.googleCalendarConnection
      .update({ where: { userId }, data: { expiresAt: new Date(0) } })
      .catch(() => {});
    res = await doFetch(await getValidAccessToken(userId));
  }
  if (res.status === 429) throw new CalendarError("rate_limited");
  if (!res.ok) throw new CalendarApiError(res.status);
  return res.json();
}
