import { getCurrentUser } from "@/lib/auth";
import { AccountForm } from "@/components/AccountForm";
import { Container } from "@/components/Container";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  return (
    <Container>
      <AccountForm
        initial={{
          fullName: user!.fullName,
          email: user!.email,
          phone: user!.phone ?? "",
        }}
      />
    </Container>
  );
}
