import { invokeStructuredAgent, dumpJson } from "@/lib/agents/base";
import { buildCareerMasterPrompt } from "@/lib/agents/prompts";
import {
  reviewerFeedbackResponseFormatSchema,
  reviewerFeedbackSchema,
  type ResumeDocument,
  type ResumeProfile,
  type ReviewerFeedback,
} from "@/lib/review/schemas";

export async function runCareerMasterReviewer(document: ResumeDocument, profile: ResumeProfile): Promise<ReviewerFeedback> {
  const feedback = await invokeStructuredAgent({
    name: "career_master_agent",
    systemPrompt: buildCareerMasterPrompt(),
    responseFormat: reviewerFeedbackResponseFormatSchema,
    normalize: (value) => reviewerFeedbackSchema.parse(value),
    userContent: `
请从职业定位、行业竞争力和长期叙事视角审阅这份简历。

简历信息：
${dumpJson(document)}

解析后的候选人画像：
${dumpJson(profile)}
    `.trim(),
  });

  return reviewerFeedbackSchema.parse({
    ...feedback,
    agentName: feedback.agentName || "career_master_agent",
    perspective: feedback.perspective || "Career Strategy",
  });
}
