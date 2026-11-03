import { dumpJson, invokeStructuredAgent, type StructuredAgentProgress } from "@/lib/agents/base";
import { formatTargetJobContext } from "@/lib/agents/workflow/prompts";
import { REVIEWER_RUBRICS, formatRubricForPrompt } from "@/lib/review/rubrics";
import { calculateReviewScoring, REVIEWER_NAMES, scoringResponseSchema } from "@/lib/review/scoring";
import type { ResumeProfile, TargetJob } from "@/lib/review/schemas";

export async function runScoringAgent(
  profile: ResumeProfile,
  targetJob: TargetJob,
  onProgress?: (event: StructuredAgentProgress) => void,
  abortSignal?: AbortSignal,
) {
  return invokeStructuredAgent({
    name: "scoring_agent",

    systemPrompt: `你负责快速完成简历的三个视角评分，只输出分数与简短证据，不输出建议、示例改写、总分或权重计算。
每个视角按以下顺序输出5个维度，每项reason最多90字，引用一条候选人事实；信息缺失时明确写缺失，不编造。
使用完整百分制：90+标杆，80-89强，70-79良好，60-69待加强，45-59偏弱，低于45严重不匹配。仅根据证据评分，不预设候选人水平。
${REVIEWER_NAMES.map((name) => `${name}:\n${formatRubricForPrompt(REVIEWER_RUBRICS[name])}`).join("\n")}`,
    userContent: `${formatTargetJobContext(targetJob)}\n候选人事实：\n${dumpJson(profile)}`,
    responseFormat: scoringResponseSchema,
    normalize: calculateReviewScoring,
    onProgress,
    abortSignal,
  });
}
