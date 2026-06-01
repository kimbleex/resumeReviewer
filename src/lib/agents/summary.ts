import { invokeStructuredAgent, dumpJson, type StructuredAgentProgress } from "@/lib/agents/base";
import { buildSummaryPrompt, formatTargetJobContext } from "@/lib/agents/prompts";
import {
  finalResumeReviewResponseFormatSchema,
  finalResumeReviewSchema,
  type FinalResumeReview,
  type ResumeDocument,
  type ResumeProfile,
  type ReviewerFeedback,
  type TargetJob,
} from "@/lib/review/schemas";

export async function runSummaryAgent(
  document: ResumeDocument,
  profile: ResumeProfile,
  reviewerFeedback: ReviewerFeedback[],
  targetJob?: TargetJob,
  onProgress?: (event: StructuredAgentProgress) => void,
): Promise<FinalResumeReview> {
  return invokeStructuredAgent({
    name: "summary_agent",
    systemPrompt: buildSummaryPrompt(),
    responseFormat: finalResumeReviewResponseFormatSchema,
    normalize: (value) => finalResumeReviewSchema.parse(value),
    onProgress,
    userContent: `
请整合下面这些结构化结果，输出最终简历修改方案。

目标岗位上下文：
${formatTargetJobContext(targetJob)}

简历信息：
${dumpJson(document)}

候选人画像：
${dumpJson(profile)}

多 Agent 反馈：
${dumpJson(reviewerFeedback)}
    `.trim(),
  });
}
