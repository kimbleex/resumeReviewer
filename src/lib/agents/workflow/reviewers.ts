import { invokeStructuredAgent, dumpJson, type StructuredAgentProgress } from "@/lib/agents/base";
import {
  buildCareerMasterPrompt,
  buildHrPrompt,
  buildInterviewerPrompt,
  formatTargetJobContext,
} from "@/lib/agents/workflow/prompts";
import {
  reviewerFeedbackResponseFormatSchema,
  reviewerFeedbackSchema,
  type ResumeProfile,
  type ReviewerFeedback,
  type TargetJob,
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
    async run(profile, targetJob, onProgress, abortSignal) {
      const feedback = await invokeStructuredAgent({
        name: options.name,
        systemPrompt: options.systemPrompt(),
        responseFormat: reviewerFeedbackResponseFormatSchema,
        normalize: (value) => reviewerFeedbackSchema.parse(value),
        onProgress,
        abortSignal,
        userContent: `
${options.instruction}

目标岗位上下文：
${formatTargetJobContext(targetJob)}

解析后的候选人结构化画像：
${dumpJson(profile)}
        `.trim(),
      });

      return reviewerFeedbackSchema.parse({
        ...feedback,
        agentName: feedback.agentName || options.name,
        perspective: feedback.perspective || options.perspective,
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
