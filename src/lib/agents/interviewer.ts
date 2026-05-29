import { invokeStructuredAgent, dumpJson, type StructuredAgentProgress } from "@/lib/agents/base";
import { buildInterviewerPrompt } from "@/lib/agents/prompts";
import {
  reviewerFeedbackResponseFormatSchema,
  reviewerFeedbackSchema,
  type ResumeDocument,
  type ResumeProfile,
  type ReviewerFeedback,
} from "@/lib/review/schemas";

export async function runInterviewerReviewer(
  document: ResumeDocument,
  profile: ResumeProfile,
  onProgress?: (event: StructuredAgentProgress) => void,
): Promise<ReviewerFeedback> {
  const feedback = await invokeStructuredAgent({
    name: "interviewer_agent",
    systemPrompt: buildInterviewerPrompt(),
    responseFormat: reviewerFeedbackResponseFormatSchema,
    normalize: (value) => reviewerFeedbackSchema.parse(value),
    onProgress,
    userContent: `
请从技术面试官视角审阅这份简历。

简历信息：
${dumpJson(document)}

解析后的候选人画像：
${dumpJson(profile)}
    `.trim(),
  });

  return reviewerFeedbackSchema.parse({
    ...feedback,
    agentName: feedback.agentName || "interviewer_agent",
    perspective: feedback.perspective || "Technical Interviewer",
  });
}
