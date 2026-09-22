import { requirePageAccess } from "@/lib/access";
import { AccountForm } from "@/components/AccountForm";
import { Container } from "@/components/Container";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  return (
    <Container>
      <AccountForm
        initial={{
          fullName: user.fullName,
          email: user.email,
          phone: user.phone ?? "",
        }}
      />
    </Container>
  );
}
