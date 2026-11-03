import { dumpJson, invokeTextAgent, type StructuredAgentProgress } from "@/lib/agents/base";
import { buildRewritePrompt, formatTargetJobContext } from "@/lib/agents/workflow/prompts";
import {
  resumeRewriteSchema,
  type ResumeRewrite,
  type ResumeDocument,
  type FinalResumeReview,
  type TargetJob,
  type ReviewCallCheckpoint,
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
  checkpoint?: ReviewCallCheckpoint,
  onCheckpoint?: (checkpoint: ReviewCallCheckpoint) => void,
): Promise<ResumeRewrite> {
  let rewrittenContent = checkpoint?.checkpoint === "rewrite_content" ? checkpoint.value.rewrittenContent : "";
  if (!rewrittenContent) {
    const text = await invokeTextAgent({
      name: "rewrite_content",
      callLabel: "改写 · 简历正文",
      systemPrompt: buildRewritePrompt(),
      onProgress,
      abortSignal,
      userContent: `本次只生成完整Markdown简历，不写改写说明，不输出JSON。严格使用以下标签：
[REWRITTEN_CONTENT]
完整Markdown简历
[/REWRITTEN_CONTENT]
${formatTargetJobContext(targetJob)}
原始简历：${document.content}
修改行动：${dumpJson({ topPriorities: finalReview.topPriorities, sectionRevisions: finalReview.sectionRevisions })}`,
    });
    rewrittenContent = extractTaggedSection(text, "REWRITTEN_CONTENT");
    if (!rewrittenContent) throw new Error("改写正文不完整，请从正文步骤重试。");
  }
  if (abortSignal?.aborted) throw new Error("诊断已被中断。");
  onCheckpoint?.({ checkpoint: "rewrite_content", value: { rewrittenContent, explanation: "" } });

  const explanationText = await invokeTextAgent({
    name: "rewrite_explanation",
    callLabel: "改写 · 修改说明",
    systemPrompt: "用简体中文简短说明已完成的实际修改，不重写简历，不编造改动。最多3条、每条60字。第一条说明使用的模板。",
    userContent: `本次只生成改写说明，严格使用标签：
[EXPLANATION]
改写说明
[/EXPLANATION]
${formatTargetJobContext(targetJob)}
原始简历：${document.content}
已完成的简历正文：${rewrittenContent}`,
    onProgress,
    abortSignal,
  });
  const explanation = extractTaggedSection(explanationText, "EXPLANATION");
  if (!explanation) throw new Error("改写说明不完整，请重试说明步骤，已完成正文会保留。");
  return resumeRewriteSchema.parse({ rewrittenContent, explanation });
}
