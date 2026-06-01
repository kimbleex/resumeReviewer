import type { StructuredAgentProgress } from "@/lib/agents/base";
import { runCareerMasterReviewer } from "@/lib/agents/career-master";
import { runHrReviewer } from "@/lib/agents/hr";
import { runInterviewerReviewer } from "@/lib/agents/interviewer";
import { runResumeParser } from "@/lib/agents/resume-parser";
import { runSummaryAgent } from "@/lib/agents/summary";
import { runRewriteAgent } from "@/lib/agents/rewrite";
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
  type TargetJob,
  type ResumeRewrite,
  targetJobSchema,
} from "@/lib/review/schemas";

export const reviewStageOrder = [
  "resume_loader",
  "resume_parser",
  "hr_agent",
  "interviewer_agent",
  "career_master_agent",
  "summary_agent",
  "rewrite_agent",
] as const;

export type ReviewStageName = (typeof reviewStageOrder)[number] | "review_pipeline";

export type ReviewerAgentExecutor = {
  name: "hr_agent" | "interviewer_agent" | "career_master_agent";
  perspective: string;
  run: (
    document: ResumeDocument,
    profile: ResumeProfile,
    targetJob: TargetJob,
    onProgress?: (event: StructuredAgentProgress) => void,
  ) => Promise<ReviewerFeedback>;
};

export type ReviewPipelineDependencies = {
  loadResume: (input: ResumeSource) => Promise<ResumeDocument>;
  runResumeParser: (
    document: ResumeDocument,
    onProgress?: (event: StructuredAgentProgress) => void,
  ) => Promise<ResumeProfile>;
  reviewerAgents: ReviewerAgentExecutor[];
  runSummary: (
    document: ResumeDocument,
    profile: ResumeProfile,
    reviewerFeedback: ReviewerFeedback[],
    targetJob: TargetJob,
    onProgress?: (event: StructuredAgentProgress) => void,
  ) => Promise<FinalResumeReview>;
  runRewrite: (
    document: ResumeDocument,
    profile: ResumeProfile,
    reviewerFeedback: ReviewerFeedback[],
    finalReview: FinalResumeReview,
    targetJob?: TargetJob,
    onProgress?: (event: StructuredAgentProgress) => void,
  ) => Promise<ResumeRewrite>;
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
  runRewrite: runRewriteAgent,
};

export type ReviewEventHandler = (event: ReviewStageEvent) => void;

const stageTitles: Record<Exclude<ReviewStageName, "review_pipeline">, string> = {
  resume_loader: "Resume Loader",
  resume_parser: "Resume Parser",
  hr_agent: "HR Agent",
  interviewer_agent: "Interviewer Agent",
  career_master_agent: "Career Master",
  summary_agent: "Summary Agent",
  rewrite_agent: "Rewrite Agent",
};

function emit(handler: ReviewEventHandler | undefined, event: ReviewStageEvent): void {
  handler?.(reviewStageEventSchema.parse(event));
}

function emitStageProgress(
  handler: ReviewEventHandler | undefined,
  stage: Exclude<ReviewStageName, "review_pipeline">,
  progress: StructuredAgentProgress,
): void {
  emit(handler, {
    kind: "stage_progress",
    stage,
    phase: progress.phase,
    title: stageTitles[stage],
    message: progress.message,
    details: progress.details ?? [],
    snippet: progress.snippet ?? "",
    payload: progress.payload ?? null,
  });
}

export async function runReviewPipeline(
  input: ResumeSource,
  eventHandler?: ReviewEventHandler,
  dependencies: Partial<ReviewPipelineDependencies> = {},
): Promise<ReviewRunResult> {
  const deps = { ...defaultDependencies, ...dependencies };
  const targetJob = targetJobSchema.parse(input.targetJob);

  emit(eventHandler, {
    kind: "stage_started",
    stage: "resume_loader",
    phase: null,
    title: "加载简历",
    message: `正在读取 ${input.resumeFile.name || "上传文件"}`,
    details: [],
    snippet: "",
    payload: null,
  });

  const document = await deps.loadResume(input);
  emit(eventHandler, {
    kind: "stage_completed",
    stage: "resume_loader",
    phase: null,
    title: "简历加载完成",
    message: `已读取 ${document.path.split(/[\\/]/).pop() ?? document.path}`,
    details: [`类型: ${document.fileType}`, `路径: ${document.path}`],
    snippet: "",
    payload: document,
  });

  emit(eventHandler, {
    kind: "stage_started",
    stage: "resume_parser",
    phase: null,
    title: "解析简历",
    message: "正在抽取候选人画像与缺口",
    details: [],
    snippet: "",
    payload: null,
  });
  const profile = await deps.runResumeParser(document, (progress) => {
    emitStageProgress(eventHandler, "resume_parser", progress);
  });
  emit(eventHandler, {
    kind: "stage_completed",
    stage: "resume_parser",
    phase: null,
    title: "解析完成",
    message: "候选人画像已生成",
    details: profile.reasoningSummary,
    snippet: "",
    payload: profile,
  });

  const reviewerFeedback = await Promise.all(
    deps.reviewerAgents.map(async (reviewer) => {
      emit(eventHandler, {
        kind: "stage_started",
        stage: reviewer.name,
        phase: null,
        title: `${stageTitles[reviewer.name]} 开始评审`,
        message: `正在从 ${reviewer.perspective} 视角分析简历`,
        details: [],
        snippet: "",
        payload: null,
      });
      const feedback = await reviewer.run(document, profile, targetJob, (progress) => {
        emitStageProgress(eventHandler, reviewer.name, progress);
      });
      emit(eventHandler, {
        kind: "stage_completed",
        stage: reviewer.name,
        phase: null,
        title: `${stageTitles[reviewer.name]} 评审完成`,
        message: `得分 ${feedback.overallScore}/100`,
        details: feedback.reasoningSummary,
        snippet: "",
        payload: feedback,
      });
      return feedback;
    }),
  );

  emit(eventHandler, {
    kind: "stage_started",
    stage: "summary_agent",
    phase: null,
    title: "汇总建议",
    message: "正在整合多 Agent 结论",
    details: [],
    snippet: "",
    payload: null,
  });
  const finalReview = await deps.runSummary(document, profile, reviewerFeedback, targetJob, (progress) => {
    emitStageProgress(eventHandler, "summary_agent", progress);
  });
  emit(eventHandler, {
    kind: "stage_completed",
    stage: "summary_agent",
    phase: null,
    title: "汇总完成",
    message: `最终得分 ${finalReview.overallScore}/100`,
    details: finalReview.reasoningSummary,
    snippet: "",
    payload: finalReview,
  });

  emit(eventHandler, {
    kind: "stage_started",
    stage: "rewrite_agent",
    phase: null,
    title: "智能改写简历",
    message: "正在根据终审建议重构简历",
    details: [],
    snippet: "",
    payload: null,
  });
  const rewriteResult = await deps.runRewrite(document, profile, reviewerFeedback, finalReview, targetJob, (progress) => {
    emitStageProgress(eventHandler, "rewrite_agent", progress);
  });
  emit(eventHandler, {
    kind: "stage_completed",
    stage: "rewrite_agent",
    phase: null,
    title: "简历改写完成",
    message: "已生成全新优化版简历",
    details: [rewriteResult.explanation],
    snippet: rewriteResult.rewrittenContent,
    payload: rewriteResult,
  });

  const result = reviewRunResultSchema.parse({
    rewrite: rewriteResult,
    document,
    targetJob,
    profile,
    reviewerFeedback,
    finalReview,
  });

  emit(eventHandler, {
    kind: "pipeline_completed",
    stage: "review_pipeline",
    phase: null,
    title: "流程完成",
    message: "简历评审已生成最终修改建议",
    details: [],
    snippet: "",
    payload: null,
  });

  return result;
}
