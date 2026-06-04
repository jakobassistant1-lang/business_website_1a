import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ConnectionsForm } from "@/components/ConnectionsForm";
import { Container } from "@/components/Container";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const user = await getCurrentUser();
  const cred = await prisma.canvasCredential.findUnique({ where: { userId: user!.id } });
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
    </Container>
  );
}
