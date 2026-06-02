import { invokeStructuredAgent, dumpJson, type StructuredAgentProgress } from "@/lib/agents/base";
import { buildRewritePrompt, formatTargetJobContext } from "@/lib/agents/prompts";
import {
  resumeRewriteResponseFormatSchema,
  resumeRewriteSchema,
  type ResumeRewrite,
  type ResumeDocument,
  type FinalResumeReview,
  type TargetJob,
} from "@/lib/review/schemas";

export async function runRewriteAgent(
  document: ResumeDocument,
  finalReview: FinalResumeReview,
  targetJob?: TargetJob,
  onProgress?: (event: StructuredAgentProgress) => void,
  abortSignal?: AbortSignal,
): Promise<ResumeRewrite> {
  return invokeStructuredAgent({
    name: "rewrite_agent",
    systemPrompt: buildRewritePrompt(),
    responseFormat: resumeRewriteResponseFormatSchema,
    normalize: (value) => resumeRewriteSchema.parse(value),
    onProgress,
    abortSignal,
    userContent: `
请根据终审修改意见，为候选人深度改写、优化并生成一份全新的 Markdown 格式简历。

目标岗位上下文：
${formatTargetJobContext(targetJob)}

原始简历内容：
${document.content}

终审汇总修改指导（来自 Summary Agent 的完整终审意见）：
${dumpJson(finalReview)}
    `.trim(),
  });
}
