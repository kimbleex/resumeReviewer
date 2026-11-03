import { invokeStructuredAgent, dumpJson, type StructuredAgentProgress } from "@/lib/agents/base";
import { buildSummaryPrompt, formatTargetJobContext } from "@/lib/agents/workflow/prompts";
import {
  summaryPrioritiesResponseSchema,
  summaryRevisionsResponseSchema,
  finalResumeReviewSchema,
  type FinalResumeReview,
  type ReviewerFeedback,
  type TargetJob,
  type ReviewCallCheckpoint,
} from "@/lib/review/schemas";

export async function runSummaryAgent(
  reviewerFeedback: ReviewerFeedback[],
  targetJob?: TargetJob,
  onProgress?: (event: StructuredAgentProgress) => void,
  abortSignal?: AbortSignal,
  scoring?: FinalResumeReview,
  checkpoint?: ReviewCallCheckpoint,
  onCheckpoint?: (checkpoint: ReviewCallCheckpoint) => void,
): Promise<FinalResumeReview> {
  if (!scoring) throw new Error("请先完成三视角评分。");
  const context = `${formatTargetJobContext(targetJob)}
已确定的加权总分：${scoring.overallScore}。
三位专家的短建议：${dumpJson(reviewerFeedback.map((feedback) => ({
    agentName: feedback.agentName, concerns: feedback.concerns, suggestions: feedback.suggestions,
  })))}`;
  const priorities = checkpoint?.checkpoint === "priorities" ? checkpoint.value : await invokeStructuredAgent({
    name: "summary_priorities",
    callLabel: "汇总 · 优先行动",
    systemPrompt: buildSummaryPrompt(),
    responseFormat: summaryPrioritiesResponseSchema,
    normalize: (value) => finalResumeReviewSchema.parse({ ...scoring, ...summaryPrioritiesResponseSchema.parse(value) }),
    onProgress,
    abortSignal,
    userContent: `本次只生成简短结论与优先行动，不生成逐板块建议。\n${context}`,
  });
  if (abortSignal?.aborted) throw new Error("诊断已被中断。");
  onCheckpoint?.({ checkpoint: "priorities", value: priorities });

  return invokeStructuredAgent({
    name: "summary_revisions",
    callLabel: "汇总 · 逐板块建议",
    systemPrompt: buildSummaryPrompt(),
    responseFormat: summaryRevisionsResponseSchema,
    normalize: (value) => finalResumeReviewSchema.parse({ ...priorities, ...summaryRevisionsResponseSchema.parse(value) }),
    onProgress,
    abortSignal,
    userContent: `本次只生成最多5条逐板块建议，不重复输出结论、优先行动或评分。
${context}
已经确定的优先行动：${dumpJson(priorities.topPriorities)}`,
  });
}
