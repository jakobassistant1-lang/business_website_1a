import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { getSetting, BRIEFING_PROMPT_KEY } from "@/lib/settings";
import { DEFAULT_BRIEFING_INSTRUCTION } from "@/lib/briefing";
import { AiSettingsForm } from "@/components/AiSettingsForm";

export const dynamic = "force-dynamic";

// Admin-only AI settings (the /admin route group already gates non-admins).
export default async function AiSettingsPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();

  const saved = await getSetting(BRIEFING_PROMPT_KEY);
  return (
    <div className="mx-auto max-w-3xl">
      <AiSettingsForm
        initialPrompt={saved ?? DEFAULT_BRIEFING_INSTRUCTION}
        defaultPrompt={DEFAULT_BRIEFING_INSTRUCTION}
        isCustom={saved !== null}
      />
    </div>
  );
}
