import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { getSetting, BRIEFING_PROMPT_KEY, ANALYSIS_PROMPT_KEY } from "@/lib/settings";
import { DEFAULT_BRIEFING_INSTRUCTION } from "@/lib/briefing";
import { DEFAULT_ANALYSIS_INSTRUCTION } from "@/lib/analysis";
import { AiSettingsForm } from "@/components/AiSettingsForm";

export const dynamic = "force-dynamic";

// Admin-only AI settings (the /admin route group already gates non-admins).
export default async function AiSettingsPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();

  const [savedBriefing, savedAnalysis] = await Promise.all([
    getSetting(BRIEFING_PROMPT_KEY),
    getSetting(ANALYSIS_PROMPT_KEY),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">AI settings</h1>
      <p className="mt-1 text-sm text-muted">
        Tune what Gemini does. Changes take effect within a minute — no redeploy. Neither prompt changes how
        assignments are <em>ranked</em> — that&apos;s deterministic logic, separate from the AI.
      </p>

      <div className="mt-8 space-y-10">
        <AiSettingsForm
          title="Daily briefing"
          description="The friendly note at the top of the Plan page. The app supplies the student's plan and ranked priorities automatically; this is the tone/coaching guidance."
          endpoint="/api/admin/briefing-prompt"
          initialPrompt={savedBriefing ?? DEFAULT_BRIEFING_INSTRUCTION}
          defaultPrompt={DEFAULT_BRIEFING_INSTRUCTION}
          isCustom={savedBriefing !== null}
        />
        <AiSettingsForm
          title="Effort & summary estimator"
          description="How Gemini estimates each assignment's effort (hours, or quick/medium/long) and writes its one-line summary. The effort feeds the planner so students never set hours by hand."
          endpoint="/api/admin/analysis-prompt"
          initialPrompt={savedAnalysis ?? DEFAULT_ANALYSIS_INSTRUCTION}
          defaultPrompt={DEFAULT_ANALYSIS_INSTRUCTION}
          isCustom={savedAnalysis !== null}
        />
      </div>
    </div>
  );
}
