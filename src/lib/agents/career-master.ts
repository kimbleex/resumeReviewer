import { invokeStructuredAgent, dumpJson, type StructuredAgentProgress } from "@/lib/agents/base";
import { buildCareerMasterPrompt, formatTargetJobContext } from "@/lib/agents/prompts";
import {
  reviewerFeedbackResponseFormatSchema,
  reviewerFeedbackSchema,
  type ResumeProfile,
  type ReviewerFeedback,
  type TargetJob,
} from "@/lib/review/schemas";

export async function runCareerMasterReviewer(
  profile: ResumeProfile,
  targetJob?: TargetJob,
  onProgress?: (event: StructuredAgentProgress) => void,
  abortSignal?: AbortSignal,
): Promise<ReviewerFeedback> {
  const feedback = await invokeStructuredAgent({
    name: "career_master_agent",
    systemPrompt: buildCareerMasterPrompt(),
    responseFormat: reviewerFeedbackResponseFormatSchema,
    normalize: (value) => reviewerFeedbackSchema.parse(value),
    onProgress,
    abortSignal,
    userContent: `
请从职业定位、行业竞争力和长期叙事视角审阅这份简历。

目标岗位上下文：
${formatTargetJobContext(targetJob)}

解析后的候选人结构化画像：
${dumpJson(profile)}
    `.trim(),
  });

  return reviewerFeedbackSchema.parse({
    ...feedback,
    agentName: feedback.agentName || "career_master_agent",
    perspective: feedback.perspective || "Career Strategy",
  });
}
