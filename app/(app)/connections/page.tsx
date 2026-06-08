import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ConnectionsForm } from "@/components/ConnectionsForm";
import { GoogleCalendarCard } from "@/components/GoogleCalendarCard";
import { getConnectionStatus } from "@/lib/googleCalendar/calendar";
import { isGoogleConfigured } from "@/lib/googleCalendar/auth";
import { Container } from "@/components/Container";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const user = await getCurrentUser();
  // Canvas (existing — untouched) and Google Calendar (new — isolated) are loaded
  // independently and in parallel; neither depends on the other. The Google read
  // is fail-open: any error there resolves to "not connected" so a calendar-side
  // fault can never take down the Canvas section of this page.
  const [cred, { conn, eventCount }] = await Promise.all([
    prisma.canvasCredential.findUnique({ where: { userId: user!.id } }),
    getConnectionStatus(user!.id).catch(() => ({ conn: null, eventCount: 0 })),
  ]);

  return (
    <Container>
      <ConnectionsForm
        initial={{
          host: cred?.host ?? "",
          hasToken: !!cred,
          status: cred?.lastValidationStatus ?? null,
          accountName: cred?.accountName ?? null,
        }}
      />
      <Suspense fallback={null}>
        <GoogleCalendarCard
          configured={isGoogleConfigured()}
          connected={!!conn}
          email={conn?.email ?? null}
          syncedAt={conn?.syncedAt ? conn.syncedAt.toISOString() : null}
          eventCount={eventCount}
        />
      </Suspense>
    </Container>
  );
}
