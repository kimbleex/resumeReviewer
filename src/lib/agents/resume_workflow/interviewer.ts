import { invokeStructuredAgent, dumpJson, type StructuredAgentProgress } from "@/lib/agents/base";
import { buildInterviewerPrompt, formatTargetJobContext } from "@/lib/agents/resume_workflow/prompts";
import {
  reviewerFeedbackResponseFormatSchema,
  reviewerFeedbackSchema,
  type ResumeProfile,
  type ReviewerFeedback,
  type TargetJob,
} from "@/lib/review/schemas";

export async function runInterviewerReviewer(
  profile: ResumeProfile,
  targetJob?: TargetJob,
  onProgress?: (event: StructuredAgentProgress) => void,
  abortSignal?: AbortSignal,
): Promise<ReviewerFeedback> {
  const feedback = await invokeStructuredAgent({
    name: "interviewer_agent",
    systemPrompt: buildInterviewerPrompt(),
    responseFormat: reviewerFeedbackResponseFormatSchema,
    normalize: (value) => reviewerFeedbackSchema.parse(value),
    onProgress,
    abortSignal,
    userContent: `
请从技术面试官视角审阅这份简历。

目标岗位上下文：
${formatTargetJobContext(targetJob)}

解析后的候选人结构化画像：
${dumpJson(profile)}
    `.trim(),
  });

  return reviewerFeedbackSchema.parse({
    ...feedback,
    agentName: feedback.agentName || "interviewer_agent",
    perspective: feedback.perspective || "Technical Interviewer",
  });
}
