import type { StructuredAgentProgress } from "@/lib/agents/base";
import { runCareerMasterReviewer } from "@/lib/agents/career-master";
import { runHrReviewer } from "@/lib/agents/hr";
import { runInterviewerReviewer } from "@/lib/agents/interviewer";
import { runResumeParser } from "@/lib/agents/resume-parser";
import { runSummaryAgent } from "@/lib/agents/summary";
import { runRewriteAgent } from "@/lib/agents/rewrite";
import { loadResumeSource, type ResumeSource } from "@/lib/resume/loader";
import {
  finalResumeReviewSchema,
  reviewRunResultSchema,
  reviewStageEventSchema,
  resumeDocumentSchema,
  resumeProfileSchema,
  resumeRewriteSchema,
  reviewerFeedbackSchema,
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
    abortSignal?: AbortSignal,
  ) => Promise<ReviewerFeedback>;
};

export type ReviewPipelineDependencies = {
  loadResume: (input: ResumeSource) => Promise<ResumeDocument>;
  runResumeParser: (
    document: ResumeDocument,
    onProgress?: (event: StructuredAgentProgress) => void,
    abortSignal?: AbortSignal,
  ) => Promise<ResumeProfile>;
  reviewerAgents: ReviewerAgentExecutor[];
  runSummary: (
    document: ResumeDocument,
    profile: ResumeProfile,
    reviewerFeedback: ReviewerFeedback[],
    targetJob: TargetJob,
    onProgress?: (event: StructuredAgentProgress) => void,
    abortSignal?: AbortSignal,
  ) => Promise<FinalResumeReview>;
  runRewrite: (
    document: ResumeDocument,
    profile: ResumeProfile,
    reviewerFeedback: ReviewerFeedback[],
    finalReview: FinalResumeReview,
    targetJob?: TargetJob,
    onProgress?: (event: StructuredAgentProgress) => void,
    abortSignal?: AbortSignal,
  ) => Promise<ResumeRewrite>;
};

export type ReviewPipelineResumeState = {
  document?: ResumeDocument;
  profile?: ResumeProfile;
  reviewerFeedback?: Partial<Record<ReviewerAgentExecutor["name"], ReviewerFeedback>>;
  finalReview?: FinalResumeReview;
  rewrite?: ResumeRewrite;
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

function throwIfAborted(abortSignal: AbortSignal | undefined): void {
  if (abortSignal?.aborted) {
    throw new Error("诊断已被中断。");
  }
}

function normalizeResumeState(state: ReviewPipelineResumeState | null | undefined): ReviewPipelineResumeState {
  if (!state) {
    return {};
  }

  const reviewerFeedback: ReviewPipelineResumeState["reviewerFeedback"] = {};
  for (const stage of ["hr_agent", "interviewer_agent", "career_master_agent"] as const) {
    const feedback = state.reviewerFeedback?.[stage];
    if (feedback) {
      reviewerFeedback[stage] = reviewerFeedbackSchema.parse(feedback);
    }
  }

  return {
    document: state.document ? resumeDocumentSchema.parse(state.document) : undefined,
    profile: state.profile ? resumeProfileSchema.parse(state.profile) : undefined,
    reviewerFeedback,
    finalReview: state.finalReview ? finalResumeReviewSchema.parse(state.finalReview) : undefined,
    rewrite: state.rewrite ? resumeRewriteSchema.parse(state.rewrite) : undefined,
  };
}

function emitCachedStageCompleted(
  handler: ReviewEventHandler | undefined,
  stage: Exclude<ReviewStageName, "review_pipeline">,
  payload: unknown,
  details: string[] = [],
): void {
  emit(handler, {
    kind: "stage_completed",
    stage,
    phase: null,
    title: `${stageTitles[stage]} 断点复用`,
    message: "已复用本地断点结果",
    details,
    snippet: "",
    payload,
  });
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
    snippet: "",
    payload: null,
  });
}

export async function runReviewPipeline(
  input: ResumeSource,
  eventHandler?: ReviewEventHandler,
  dependencies: Partial<ReviewPipelineDependencies> = {},
  options: { resumeState?: ReviewPipelineResumeState | null; abortSignal?: AbortSignal } = {},
): Promise<ReviewRunResult> {
  const deps = { ...defaultDependencies, ...dependencies };
  const targetJob = targetJobSchema.parse(input.targetJob);
  const resumeState = normalizeResumeState(options.resumeState);
  const abortSignal = options.abortSignal;

  throwIfAborted(abortSignal);
  const document = resumeState.document ?? (await (async () => {
    emit(eventHandler, {
      kind: "stage_started",
      stage: "resume_loader",
      phase: null,
      title: "加载简历",
      message: `正在读取 ${input.resumeFile.name || "上传文件"}`,
      details: [`待加载简历源文件: ${input.resumeFile.name || "未命名文档"}`],
      snippet: "",
      payload: null,
    });

    const loadedDocument = await deps.loadResume(input);
    emit(eventHandler, {
      kind: "stage_completed",
      stage: "resume_loader",
      phase: null,
      title: "简历加载完成",
      message: `已读取 ${loadedDocument.path.split(/[\\/]/).pop() ?? loadedDocument.path}`,
      details: [`类型: ${loadedDocument.fileType}`, `路径: ${loadedDocument.path}`],
      snippet: "",
      payload: loadedDocument,
    });
    return loadedDocument;
  })());
  if (resumeState.document) {
    emitCachedStageCompleted(eventHandler, "resume_loader", document, [`类型: ${document.fileType}`, `路径: ${document.path}`]);
  }

  throwIfAborted(abortSignal);
  const profile = resumeState.profile ?? (await (async () => {
    emit(eventHandler, {
      kind: "stage_started",
      stage: "resume_parser",
      phase: null,
      title: "解析简历",
      message: "正在抽取候选人画像与缺口",
      details: [
        "已成功接收来自 Loader (加载简历) 节点的简历原始文件文本。",
        "已成功接收目标岗位要求，开始抽取核心工作经历与关键专业技能。"
      ],
      snippet: "",
      payload: null,
    });
    const parsedProfile = await deps.runResumeParser(
      document,
      (progress) => {
        emitStageProgress(eventHandler, "resume_parser", progress);
      },
      abortSignal,
    );
    emit(eventHandler, {
      kind: "stage_completed",
      stage: "resume_parser",
      phase: null,
      title: "解析完成",
      message: "候选人画像已生成",
      details: parsedProfile.reasoningSummary,
      snippet: "",
      payload: parsedProfile,
    });
    return parsedProfile;
  })());
  if (resumeState.profile) {
    emitCachedStageCompleted(eventHandler, "resume_parser", profile, profile.reasoningSummary);
  }

  throwIfAborted(abortSignal);
  const reviewerFeedback = await Promise.all(
    deps.reviewerAgents.map(async (reviewer) => {
      const cachedFeedback = resumeState.reviewerFeedback?.[reviewer.name];
      if (cachedFeedback) {
        emitCachedStageCompleted(eventHandler, reviewer.name, cachedFeedback, cachedFeedback.reasoningSummary);
        return cachedFeedback;
      }

      emit(eventHandler, {
        kind: "stage_started",
        stage: reviewer.name,
        phase: null,
        title: `${stageTitles[reviewer.name]} 开始评审`,
        message: `正在从 ${reviewer.perspective} 视角分析简历`,
        details: [
          "已成功接收来自 Loader 节点的原始简历文本。",
          "已成功接收来自 Parser 节点的候选人结构化画像与评估维度。",
          `已成功接收目标岗位配置: 【${targetJob.title}】的胜任标准。`
        ],
        snippet: "",
        payload: null,
      });
      const feedback = await reviewer.run(
        document,
        profile,
        targetJob,
        (progress) => {
          emitStageProgress(eventHandler, reviewer.name, progress);
        },
        abortSignal,
      );
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

  throwIfAborted(abortSignal);
  const finalReview = resumeState.finalReview ?? (await (async () => {
    emit(eventHandler, {
      kind: "stage_started",
      stage: "summary_agent",
      phase: null,
      title: "汇总建议",
      message: "正在整合多 Agent 结论",
      details: [
        "已成功接收来自 Parser 节点的完整候选人画像与结构化信息。",
        "已成功接收来自 HR Agent 视角的初筛报告与评估得分。",
        "已成功接收来自 Interviewer Agent 视角的面试评估与评分。",
        "已成功接收来自 Career Master Agent 视角的职业规划与胜任度建议。"
      ],
      snippet: "",
      payload: null,
    });
    const review = await deps.runSummary(
      document,
      profile,
      reviewerFeedback,
      targetJob,
      (progress) => {
        emitStageProgress(eventHandler, "summary_agent", progress);
      },
      abortSignal,
    );
    emit(eventHandler, {
      kind: "stage_completed",
      stage: "summary_agent",
      phase: null,
      title: "汇总完成",
      message: `最终得分 ${review.overallScore}/100`,
      details: review.reasoningSummary,
      snippet: "",
      payload: review,
    });
    return review;
  })());
  if (resumeState.finalReview) {
    emitCachedStageCompleted(eventHandler, "summary_agent", finalReview, finalReview.reasoningSummary);
  }

  throwIfAborted(abortSignal);
  const rewriteResult = resumeState.rewrite ?? (await (async () => {
    emit(eventHandler, {
      kind: "stage_started",
      stage: "rewrite_agent",
      phase: null,
      title: "智能改写简历",
      message: "正在根据终审建议重构简历",
      details: [
        "已成功接收来自 Summary Agent 节点的终审改写优化指导意见。",
        "已成功接收来自 3 个评审 Expert Agent 的全方位反馈与得分明细。",
        "已成功接收来自 Parser 节点的简历画像数据与 Loader 的原始文档结构。"
      ],
      snippet: "",
      payload: null,
    });
    const rewrite = await deps.runRewrite(
      document,
      profile,
      reviewerFeedback,
      finalReview,
      targetJob,
      (progress) => {
        emitStageProgress(eventHandler, "rewrite_agent", progress);
      },
      abortSignal,
    );
    emit(eventHandler, {
      kind: "stage_completed",
      stage: "rewrite_agent",
      phase: null,
      title: "简历改写完成",
      message: "已生成全新优化版简历",
      details: [rewrite.explanation],
      snippet: "",
      payload: rewrite,
    });
    return rewrite;
  })());
  if (resumeState.rewrite) {
    emitCachedStageCompleted(eventHandler, "rewrite_agent", rewriteResult, [rewriteResult.explanation]);
  }

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
