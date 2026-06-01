import { invokeStructuredAgent, dumpJson, type StructuredAgentProgress } from "@/lib/agents/base";
import { buildRewritePrompt, formatTargetJobContext } from "@/lib/agents/prompts";
import {
  resumeRewriteResponseFormatSchema,
  resumeRewriteSchema,
  type ResumeRewrite,
  type ResumeDocument,
  type ResumeProfile,
  type ReviewerFeedback,
  type FinalResumeReview,
  type TargetJob,
} from "@/lib/review/schemas";

export async function runRewriteAgent(
  document: ResumeDocument,
  profile: ResumeProfile,
  reviewerFeedback: ReviewerFeedback[],
  finalReview: FinalResumeReview,
  targetJob?: TargetJob,
  onProgress?: (event: StructuredAgentProgress) => void,
): Promise<ResumeRewrite> {
  return invokeStructuredAgent({
    name: "rewrite_agent",
    systemPrompt: buildRewritePrompt(),
    responseFormat: resumeRewriteResponseFormatSchema,
    normalize: (value) => resumeRewriteSchema.parse(value),
    onProgress,
    userContent: `
请结合所有的多 Agent 评审意见与最终修改意见，为候选人深度改写、优化并生成一份全新的 Markdown 格式简历。

目标岗位上下文：
${formatTargetJobContext(targetJob)}

原始简历内容：
${document.content}

个人基本画像：
${dumpJson(profile)}

多视角 Agent 评审意见：
${dumpJson(reviewerFeedback)}

最终汇总修改指导：
${dumpJson(finalReview)}
    `.trim(),
  });
}
