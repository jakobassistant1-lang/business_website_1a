// Google Calendar API client: produces a valid access token for a user
// (refreshing + persisting when expired) and performs authenticated calls.
// Server-only. Token values are decrypted only in memory here.

import { prisma } from "../prisma";
import { decryptSecret, encryptSecret } from "../crypto";
import { refreshAccessToken } from "./auth";

const SKEW_MS = 60_000; // refresh a minute before expiry
const API_BASE = "https://www.googleapis.com/calendar/v3";
const TIMEOUT_MS = 10_000;

export class CalendarApiError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? `calendar_api_${status}`);
  }
}

/** A currently-valid access token, refreshing + persisting if the stored one
 *  has expired. Throws "not_connected" / "token_expired" for callers to map. */
export async function getValidAccessToken(userId: number): Promise<string> {
  const conn = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
  if (!conn || !conn.accessToken) throw new Error("not_connected");

  const valid = conn.expiresAt && conn.expiresAt.getTime() - SKEW_MS > Date.now();
  if (valid) return decryptSecret(conn.accessToken);

  if (!conn.refreshToken) throw new Error("token_expired");
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
}

/** Authenticated GET against the Calendar API, with one auto-retry on 401. */
export async function calendarApiGet(userId: number, path: string): Promise<unknown> {
  const doFetch = async (token: string) => {
    // Bound the request so a hung Google connection can't stall a sync forever.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await doFetch(await getValidAccessToken(userId));
  if (res.status === 401) {
    // Token rejected — force a refresh (clear expiry) and retry once.
    await prisma.googleCalendarConnection
      .update({ where: { userId }, data: { expiresAt: new Date(0) } })
      .catch(() => {});
    res = await doFetch(await getValidAccessToken(userId));
  }
  if (res.status === 429) throw new CalendarApiError(429, "rate_limited");
  if (!res.ok) throw new CalendarApiError(res.status);
  return res.json();
}
