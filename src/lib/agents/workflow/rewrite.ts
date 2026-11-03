import { dumpJson, invokeTextAgent, type StructuredAgentProgress } from "@/lib/agents/base";
import { buildRewritePrompt, formatTargetJobContext } from "@/lib/agents/workflow/prompts";
import {
  resumeRewriteSchema,
  type ResumeRewrite,
  type ResumeDocument,
  type FinalResumeReview,
  type TargetJob,
} from "@/lib/review/schemas";

function extractTaggedSection(text: string, tag: string): string {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`\\[${escapedTag}\\]([\\s\\S]*?)\\[/${escapedTag}\\]`, "i"));
  return match?.[1]?.trim() ?? "";
}

export async function runRewriteAgent(
  document: ResumeDocument,
  finalReview: FinalResumeReview,
  targetJob?: TargetJob,
  onProgress?: (event: StructuredAgentProgress) => void,
  abortSignal?: AbortSignal,
): Promise<ResumeRewrite> {
  const text = await invokeTextAgent({
    name: "rewrite_agent",
    systemPrompt: buildRewritePrompt(),
    onProgress,
    abortSignal,
    userContent: `
请根据终审修改意见，为候选人深度改写、优化并生成一份全新的 Markdown 格式简历。
不要输出 JSON。请严格使用以下两个纯文本分段标签，标签必须原样保留：

[REWRITTEN_CONTENT]
这里输出完整 Markdown 简历
[/REWRITTEN_CONTENT]

[EXPLANATION]
这里输出 4-6 条本次改写说明
[/EXPLANATION]

目标岗位上下文：
${formatTargetJobContext(targetJob)}

原始简历内容：
${document.content}

终审汇总修改指导（来自 Summary Agent 的完整终审意见）：
${dumpJson(finalReview)}
    `.trim(),
  });

  const rewrittenContent = extractTaggedSection(text, "REWRITTEN_CONTENT") || text.trim();
  const explanation =
    extractTaggedSection(text, "EXPLANATION") ||
    "已根据 Summary Agent 的终审意见完成简历重构，强化岗位匹配度、项目表达、技术细节与结果呈现。";

  return resumeRewriteSchema.parse({
    rewrittenContent,
    explanation,
  });
}
