import { invokeStructuredAgent, dumpJson, type StructuredAgentProgress } from "@/lib/agents/base";
import { runScoringAgent } from "@/lib/agents/workflow/scoring";
import {
  buildCareerMasterPrompt,
  buildHrPrompt,
  buildInterviewerPrompt,
  formatTargetJobContext,
} from "@/lib/agents/workflow/prompts";
import {
  reviewerAssessmentResponseSchema,
  reviewerSuggestionsResponseSchema,
  reviewerFeedbackSchema,
  type ResumeProfile,
  type ReviewerFeedback,
  type TargetJob,
  type ReviewCallCheckpoint,
} from "@/lib/review/schemas";

export type ReviewerName = "hr_agent" | "interviewer_agent" | "career_master_agent";

export type ReviewerAgent = {
  name: ReviewerName;
  perspective: string;
  run: (
    profile: ResumeProfile,
    targetJob: TargetJob,
    onProgress?: (event: StructuredAgentProgress) => void,
    abortSignal?: AbortSignal,
    checkpoint?: ReviewCallCheckpoint,
    onCheckpoint?: (checkpoint: ReviewCallCheckpoint) => void,
  ) => Promise<ReviewerFeedback>;
};

function createReviewer(options: {
  name: ReviewerName;
  perspective: string;
  systemPrompt: () => string;
  instruction: string;
}): ReviewerAgent {
  return {
    name: options.name,
    perspective: options.perspective,
    async run(profile, targetJob, onProgress, abortSignal, checkpoint, onCheckpoint) {
      const scoring = checkpoint?.checkpoint === "score" || checkpoint?.checkpoint === "assessment"
        ? checkpoint.value
        : await runScoringAgent(options.name, options.perspective, profile, targetJob, onProgress, abortSignal);
      if (abortSignal?.aborted) throw new Error("诊断已被中断。");
      if (checkpoint?.checkpoint !== "assessment") onCheckpoint?.({ checkpoint: "score", value: scoring });
      const context = `${formatTargetJobContext(targetJob)}
候选人画像：${dumpJson(profile)}
本视角评分（保持不变）：${dumpJson(scoring)}`;
      const assessment = checkpoint?.checkpoint === "assessment" ? checkpoint.value : await invokeStructuredAgent({
        name: `${options.name}_assessment`,
        callLabel: `${options.perspective} · 优势与问题`,
        systemPrompt: options.systemPrompt(),
        responseFormat: reviewerAssessmentResponseSchema,
        normalize: (value) => reviewerFeedbackSchema.parse({ ...scoring, ...reviewerAssessmentResponseSchema.parse(value) }),
        onProgress,
        abortSignal,
        userContent: `${options.instruction}\n本次只输出优势、问题和一句核心判断；修改建议将在下次调用生成。\n${context}`,
      });
      if (abortSignal?.aborted) throw new Error("诊断已被中断。");
      onCheckpoint?.({ checkpoint: "assessment", value: assessment });

      const feedback = await invokeStructuredAgent({
        name: `${options.name}_suggestions`,
        callLabel: `${options.perspective} · 修改建议`,
        systemPrompt: options.systemPrompt(),
        responseFormat: reviewerSuggestionsResponseSchema,
        normalize: (value) => reviewerFeedbackSchema.parse({ ...assessment, ...reviewerSuggestionsResponseSchema.parse(value) }),
        onProgress,
        abortSignal,
        userContent: `本次只针对已发现的问题给出最多3条建议，不重复输出分析或评分。
${context}
上次判断：${dumpJson({ strengths: assessment.strengths, concerns: assessment.concerns, reasoningSummary: assessment.reasoningSummary })}`,
      });

      return reviewerFeedbackSchema.parse({
        ...feedback,
        agentName: options.name,
        perspective: options.perspective,
      });
    },
  };
}

export const reviewerAgents: ReviewerAgent[] = [
  createReviewer({
    name: "hr_agent",
    perspective: "HR / ATS",
    systemPrompt: buildHrPrompt,
    instruction: "请从 HR / ATS / 招聘筛选视角审阅这份简历。",
  }),
  createReviewer({
    name: "interviewer_agent",
    perspective: "Technical Interviewer",
    systemPrompt: buildInterviewerPrompt,
    instruction: "请从技术面试官视角审阅这份简历。",
  }),
  createReviewer({
    name: "career_master_agent",
    perspective: "Career Strategy",
    systemPrompt: buildCareerMasterPrompt,
    instruction: "请从职业定位、行业竞争力和长期叙事视角审阅这份简历。",
  }),
];
