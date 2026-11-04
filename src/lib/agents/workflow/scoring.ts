import { dumpJson, invokeStructuredAgent, type StructuredAgentProgress } from "@/lib/agents/base";
import { formatTargetJobContext } from "@/lib/agents/workflow/prompts";
import { REVIEWER_RUBRICS, formatRubricForPrompt } from "@/lib/review/rubrics";
import { calculateReviewerScore, expertScoreSchema, type ReviewerName } from "@/lib/review/scoring";
import type { ResumeProfile, TargetJob } from "@/lib/review/schemas";

export async function runScoringAgent(
  reviewer: ReviewerName,
  perspective: string,
  profile: ResumeProfile,
  targetJob: TargetJob,
  onProgress?: (event: StructuredAgentProgress) => void,
  abortSignal?: AbortSignal,
) {
  return invokeStructuredAgent({
    name: `${reviewer}_score`,
    callLabel: `${perspective} · 评分`,

    systemPrompt: `你只负责从 ${perspective} 视角评分，只输出本视角的分数与简短证据，不输出其他视角、建议、示例改写、总分或权重计算。
按以下顺序输出5个维度，每项reason最多90字，引用一条候选人事实；信息缺失时明确写缺失，不编造。
使用完整百分制：90+标杆，80-89强，70-79良好，60-69待加强，45-59偏弱，低于45严重不匹配。仅根据证据评分，不预设候选人水平。
${formatRubricForPrompt(REVIEWER_RUBRICS[reviewer])}`,
    userContent: `${formatTargetJobContext(targetJob)}\n候选人事实：\n${dumpJson(profile)}`,
    responseFormat: expertScoreSchema,
    normalize: (value) => calculateReviewerScore(reviewer, value),
    onProgress,
    abortSignal,
  });
}
