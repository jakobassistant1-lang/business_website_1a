import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { getSetting, BRIEFING_PROMPT_KEY, ANALYSIS_PROMPT_KEY, PERIOD_COACH_PROMPT_KEY, STUDY_PROMPT_KEYS } from "@/lib/settings";
import { DEFAULT_BRIEFING_INSTRUCTION, DEFAULT_PERIOD_COACH_INSTRUCTION } from "@/lib/briefing";
import { DEFAULT_ANALYSIS_INSTRUCTION } from "@/lib/analysis";
import {
  DEFAULT_STUDY_PLAN_INSTRUCTION,
  DEFAULT_STUDY_GUIDE_INSTRUCTION,
  DEFAULT_STUDY_QUESTIONS_INSTRUCTION,
} from "@/lib/study";
import { AiSettingsForm } from "@/components/AiSettingsForm";
import { StudyPromptsSettings } from "@/components/StudyPromptsSettings";

export const dynamic = "force-dynamic";

// Admin-only AI settings (the /admin route group already gates non-admins).
export default async function AiSettingsPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();

  const [savedBriefing, savedAnalysis, savedCoach, savedPlan, savedGuide, savedQuestions] = await Promise.all([
    getSetting(BRIEFING_PROMPT_KEY),
    getSetting(ANALYSIS_PROMPT_KEY),
    getSetting(PERIOD_COACH_PROMPT_KEY),
    getSetting(STUDY_PROMPT_KEYS.plan),
    getSetting(STUDY_PROMPT_KEYS.guide),
    getSetting(STUDY_PROMPT_KEYS.questions),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">AI settings</h1>
      <p className="mt-1 text-sm text-muted">
        Tune what Gemini does. Changes take effect within a minute — no redeploy. Neither prompt changes how
        assignments are <em>ranked</em> — that&apos;s deterministic logic, separate from the AI.
      </p>

      <div className="mt-8 space-y-10">
        <StudyPromptsSettings
          initial={{
            plan: { prompt: savedPlan ?? DEFAULT_STUDY_PLAN_INSTRUCTION, isCustom: savedPlan !== null },
            guide: { prompt: savedGuide ?? DEFAULT_STUDY_GUIDE_INSTRUCTION, isCustom: savedGuide !== null },
            questions: { prompt: savedQuestions ?? DEFAULT_STUDY_QUESTIONS_INSTRUCTION, isCustom: savedQuestions !== null },
          }}
          defaults={{
            plan: DEFAULT_STUDY_PLAN_INSTRUCTION,
            guide: DEFAULT_STUDY_GUIDE_INSTRUCTION,
            questions: DEFAULT_STUDY_QUESTIONS_INSTRUCTION,
          }}
        />
        <AiSettingsForm
          title="Study coach (Calendar & Timeline)"
          description="The game-plan note at the top of each Calendar/Timeline period. The app supplies the student's scheduled, deadline-safe priorities for that day/week/month automatically; this is where you tune the tone and which learning-science techniques it leans on."
          endpoint="/api/admin/period-coach-prompt"
          initialPrompt={savedCoach ?? DEFAULT_PERIOD_COACH_INSTRUCTION}
          defaultPrompt={DEFAULT_PERIOD_COACH_INSTRUCTION}
          isCustom={savedCoach !== null}
        />
        <AiSettingsForm
          title="Daily briefing (legacy)"
          description="The friendly note used by the original Plan view. The app supplies the student's plan and ranked priorities automatically; this is the tone/coaching guidance."
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
