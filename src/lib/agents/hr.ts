import { invokeStructuredAgent, dumpJson, type StructuredAgentProgress } from "@/lib/agents/base";
import { buildHrPrompt, formatTargetJobContext } from "@/lib/agents/prompts";
import {
  reviewerFeedbackResponseFormatSchema,
  reviewerFeedbackSchema,
  type ResumeProfile,
  type ReviewerFeedback,
  type TargetJob,
} from "@/lib/review/schemas";

export async function runHrReviewer(
  profile: ResumeProfile,
  targetJob?: TargetJob,
  onProgress?: (event: StructuredAgentProgress) => void,
  abortSignal?: AbortSignal,
): Promise<ReviewerFeedback> {
  const feedback = await invokeStructuredAgent({
    name: "hr_agent",
    systemPrompt: buildHrPrompt(),
    responseFormat: reviewerFeedbackResponseFormatSchema,
    normalize: (value) => reviewerFeedbackSchema.parse(value),
    onProgress,
    abortSignal,
    userContent: `
请从 HR / ATS / 招聘筛选视角审阅这份简历。

目标岗位上下文：
${formatTargetJobContext(targetJob)}

解析后的候选人结构化画像：
${dumpJson(profile)}
    `.trim(),
  });

  return reviewerFeedbackSchema.parse({
    ...feedback,
    agentName: feedback.agentName || "hr_agent",
    perspective: feedback.perspective || "HR / ATS",
  });
}
