import { runCareerMasterReviewer } from "@/lib/agents/career-master";
import { runHrReviewer } from "@/lib/agents/hr";
import { runInterviewerReviewer } from "@/lib/agents/interviewer";
import { runResumeParser } from "@/lib/agents/resume-parser";
import { runSummaryAgent } from "@/lib/agents/summary";
import { loadResumeSource, type ResumeSource } from "@/lib/resume/loader";
import {
  reviewRunResultSchema,
  reviewStageEventSchema,
  type FinalResumeReview,
  type ResumeDocument,
  type ResumeProfile,
  type ReviewRunResult,
  type ReviewStageEvent,
  type ReviewerFeedback,
} from "@/lib/review/schemas";

export const reviewStageOrder = [
  "resume_loader",
  "resume_parser",
  "hr_agent",
  "interviewer_agent",
  "career_master_agent",
  "summary_agent",
] as const;

export type ReviewStageName = (typeof reviewStageOrder)[number] | "review_pipeline";

export type ReviewerAgentExecutor = {
  name: "hr_agent" | "interviewer_agent" | "career_master_agent";
  perspective: string;
  run: (document: ResumeDocument, profile: ResumeProfile) => Promise<ReviewerFeedback>;
};

export type ReviewPipelineDependencies = {
  loadResume: (input: ResumeSource) => Promise<ResumeDocument>;
  runResumeParser: (document: ResumeDocument) => Promise<ResumeProfile>;
  reviewerAgents: ReviewerAgentExecutor[];
  runSummary: (
    document: ResumeDocument,
    profile: ResumeProfile,
    reviewerFeedback: ReviewerFeedback[],
  ) => Promise<FinalResumeReview>;
};

const defaultDependencies: ReviewPipelineDependencies = {
  loadResume: loadResumeSource,
  runResumeParser,
  reviewerAgents: [
    { name: "hr_agent", perspective: "HR / ATS", run: runHrReviewer },
    { name: "interviewer_agent", perspective: "Technical Interviewer", run: runInterviewerReviewer },
    { name: "career_master_agent", perspective: "Career Strategy", run: runCareerMasterReviewer },
  ],
  runSummary: runSummaryAgent,
};

export type ReviewEventHandler = (event: ReviewStageEvent) => void;

function emit(handler: ReviewEventHandler | undefined, event: ReviewStageEvent): void {
  handler?.(reviewStageEventSchema.parse(event));
}

export async function runReviewPipeline(
  input: ResumeSource,
  eventHandler?: ReviewEventHandler,
  dependencies: Partial<ReviewPipelineDependencies> = {},
): Promise<ReviewRunResult> {
  const deps = { ...defaultDependencies, ...dependencies };

  emit(eventHandler, {
    kind: "stage_started",
    stage: "resume_loader",
    title: "加载简历",
    message: `正在读取 ${input.resumeFile.name || "上传文件"}`,
    details: [],
    payload: null,
  });

  const document = await deps.loadResume(input);
  emit(eventHandler, {
    kind: "stage_completed",
    stage: "resume_loader",
    title: "简历加载完成",
    message: `已读取 ${document.path.split(/[\\/]/).pop() ?? document.path}`,
    details: [`类型: ${document.fileType}`, `路径: ${document.path}`],
    payload: document,
  });

  emit(eventHandler, {
    kind: "stage_started",
    stage: "resume_parser",
    title: "解析简历",
    message: "正在抽取候选人画像与缺口",
    details: [],
    payload: null,
  });
  const profile = await deps.runResumeParser(document);
  emit(eventHandler, {
    kind: "stage_completed",
    stage: "resume_parser",
    title: "解析完成",
    message: "候选人画像已生成",
    details: profile.reasoningSummary,
    payload: profile,
  });

  const reviewerFeedback = await Promise.all(
    deps.reviewerAgents.map(async (reviewer) => {
      emit(eventHandler, {
        kind: "stage_started",
        stage: reviewer.name,
        title: `${reviewer.name} 开始评审`,
        message: `正在从 ${reviewer.perspective} 视角分析简历`,
        details: [],
        payload: null,
      });
      const feedback = await reviewer.run(document, profile);
      emit(eventHandler, {
        kind: "stage_completed",
        stage: reviewer.name,
        title: `${reviewer.name} 评审完成`,
        message: `得分 ${feedback.overallScore}/100`,
        details: feedback.reasoningSummary,
        payload: feedback,
      });
      return feedback;
    }),
  );

  emit(eventHandler, {
    kind: "stage_started",
    stage: "summary_agent",
    title: "汇总建议",
    message: "正在整合多 Agent 结论",
    details: [],
    payload: null,
  });
  const finalReview = await deps.runSummary(document, profile, reviewerFeedback);
  emit(eventHandler, {
    kind: "stage_completed",
    stage: "summary_agent",
    title: "汇总完成",
    message: `最终得分 ${finalReview.overallScore}/100`,
    details: finalReview.reasoningSummary,
    payload: finalReview,
  });

  const result = reviewRunResultSchema.parse({
    document,
    profile,
    reviewerFeedback,
    finalReview,
  });

  emit(eventHandler, {
    kind: "pipeline_completed",
    stage: "review_pipeline",
    title: "流程完成",
    message: "简历评审已生成最终修改建议",
    details: [],
    payload: null,
  });

  return result;
}
