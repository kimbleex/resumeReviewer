import type { StructuredAgentProgress } from "@/lib/agents/base";
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
  run: (
    document: ResumeDocument,
    profile: ResumeProfile,
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
    onProgress?: (event: StructuredAgentProgress) => void,
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

const stageTitles: Record<Exclude<ReviewStageName, "review_pipeline">, string> = {
  resume_loader: "Resume Loader",
  resume_parser: "Resume Parser",
  hr_agent: "HR Agent",
  interviewer_agent: "Interviewer Agent",
  career_master_agent: "Career Master",
  summary_agent: "Summary Agent",
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
      const feedback = await reviewer.run(document, profile, (progress) => {
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
  const finalReview = await deps.runSummary(document, profile, reviewerFeedback, (progress) => {
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

  const result = reviewRunResultSchema.parse({
    document,
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
