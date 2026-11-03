import { invokeStructuredAgent, dumpJson, type StructuredAgentProgress } from "@/lib/agents/base";
import { buildSummaryPrompt, formatTargetJobContext } from "@/lib/agents/workflow/prompts";
import {
  finalResumeReviewResponseFormatSchema,
  finalResumeReviewSchema,
  type FinalResumeReview,
  type ReviewerFeedback,
  type TargetJob,
} from "@/lib/review/schemas";

export async function runSummaryAgent(
  reviewerFeedback: ReviewerFeedback[],
  targetJob?: TargetJob,
  onProgress?: (event: StructuredAgentProgress) => void,
  abortSignal?: AbortSignal,
): Promise<FinalResumeReview> {
  return invokeStructuredAgent({
    name: "summary_agent",
    systemPrompt: buildSummaryPrompt(),
    responseFormat: finalResumeReviewResponseFormatSchema,
    normalize: (value) => finalResumeReviewSchema.parse(value),
    onProgress,
    abortSignal,
    userContent: `
请整合下面三位专家 Agent 的评审意见，输出最终简历修改方案。

目标岗位上下文：
${formatTargetJobContext(targetJob)}

HR Agent 评审反馈：
${dumpJson(reviewerFeedback.find(f => f.agentName === "hr_agent") || reviewerFeedback[0])}

Interviewer Agent 评审反馈：
${dumpJson(reviewerFeedback.find(f => f.agentName === "interviewer_agent") || reviewerFeedback[1])}

Career Master Agent 评审反馈：
${dumpJson(reviewerFeedback.find(f => f.agentName === "career_master_agent") || reviewerFeedback[2])}
    `.trim(),
  });
}
