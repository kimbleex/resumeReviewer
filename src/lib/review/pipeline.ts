import type { StructuredAgentProgress } from "@/lib/agents/base";
import { runResumeParser } from "@/lib/agents/workflow/resume-parser";
import { reviewerAgents, type ReviewerAgent } from "@/lib/agents/workflow/reviewers";
import { runRewriteAgent } from "@/lib/agents/workflow/rewrite";
import { runSummaryAgent } from "@/lib/agents/workflow/summary";
import { runScoringAgent } from "@/lib/agents/workflow/scoring";
import { reviewScoringSchema, type ReviewScoring } from "@/lib/review/scoring";
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
  reviewCallCheckpointSchema,
  type ReviewCallCheckpoint,
} from "@/lib/review/schemas";
import type { ReviewStageName } from "@/lib/review/stages";

type ReviewPipelineDependencies = {
  loadResume: (input: ResumeSource) => Promise<ResumeDocument>;
  runResumeParser: (
    document: ResumeDocument,
    onProgress?: (event: StructuredAgentProgress) => void,
    abortSignal?: AbortSignal,
  ) => Promise<ResumeProfile>;
  reviewerAgents: ReviewerAgent[];
  runScoring: typeof runScoringAgent;
  runSummary: (
    reviewerFeedback: ReviewerFeedback[],
    targetJob: TargetJob,
    onProgress?: (event: StructuredAgentProgress) => void,
    abortSignal?: AbortSignal,
    scoring?: FinalResumeReview,
    checkpoint?: ReviewCallCheckpoint,
    onCheckpoint?: (checkpoint: ReviewCallCheckpoint) => void,
  ) => Promise<FinalResumeReview>;
  runRewrite: (
    document: ResumeDocument,
    finalReview: FinalResumeReview,
    targetJob?: TargetJob,
    onProgress?: (event: StructuredAgentProgress) => void,
    abortSignal?: AbortSignal,
    checkpoint?: ReviewCallCheckpoint,
    onCheckpoint?: (checkpoint: ReviewCallCheckpoint) => void,
  ) => Promise<ResumeRewrite>;
};

export type ReviewPipelineResumeState = {
  document?: ResumeDocument;
  profile?: ResumeProfile;
  scoring?: ReviewScoring;
  checkpoints?: Partial<Record<ReviewStageName, ReviewCallCheckpoint>>;
  reviewerFeedback?: Partial<Record<ReviewerAgent["name"], ReviewerFeedback>>;
  finalReview?: FinalResumeReview;
  rewrite?: ResumeRewrite;
};

const defaultDependencies: ReviewPipelineDependencies = {
  loadResume: loadResumeSource,
  runResumeParser,
  reviewerAgents,
  runScoring: runScoringAgent,
  runSummary: runSummaryAgent,
  runRewrite: runRewriteAgent,
};

type ReviewEventHandler = (event: ReviewStageEvent) => void;

const stageTitles: Record<ReviewStageName, string> = {
  resume_loader: "Resume Loader",
  resume_parser: "Resume Parser",
  scoring_agent: "三视角评分",
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
  const checkpoints: NonNullable<ReviewPipelineResumeState["checkpoints"]> = {};
  if (state.scoring) {
    const allowedSteps = {
      hr_agent: "assessment", interviewer_agent: "assessment", career_master_agent: "assessment",
      summary_agent: "priorities", rewrite_agent: "rewrite_content",
    } as const;
    for (const [stage, step] of Object.entries(allowedSteps)) {
      const checkpoint = state.checkpoints?.[stage as ReviewStageName];
      if (checkpoint) {
        const parsed = reviewCallCheckpointSchema.parse(checkpoint);
        if (parsed.checkpoint !== step) throw new Error("本地小步骤断点与阶段不匹配，请重跑该阶段。");
        checkpoints[stage as ReviewStageName] = parsed;
      }
    }
  }
  for (const stage of ["hr_agent", "interviewer_agent", "career_master_agent"] as const) {
    const feedback = state.reviewerFeedback?.[stage];
    if (feedback && state.scoring) {
      reviewerFeedback[stage] = reviewerFeedbackSchema.parse(feedback);
    }
  }

  return {
    document: state.document ? resumeDocumentSchema.parse(state.document) : undefined,
    profile: state.profile ? resumeProfileSchema.parse(state.profile) : undefined,
    scoring: state.scoring ? reviewScoringSchema.parse(state.scoring) : undefined,
    checkpoints,
    reviewerFeedback,
    // Legacy runs have no scoring checkpoint; only their source/profile can be reused.
    finalReview: state.scoring && state.finalReview ? finalResumeReviewSchema.parse(state.finalReview) : undefined,
    rewrite: state.scoring && state.rewrite ? resumeRewriteSchema.parse(state.rewrite) : undefined,
  };
}

function emitCachedStageCompleted(
  handler: ReviewEventHandler | undefined,
  stage: ReviewStageName,
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
  stage: ReviewStageName,
  progress: StructuredAgentProgress,
): void {
  emit(handler, {
    kind: "stage_progress",
    stage,
    phase: progress.phase,
    title: stageTitles[stage],
    message: progress.callLabel ? `${progress.callLabel}：${progress.message}` : progress.message,
    details: progress.details ?? [],
    snippet: "",
    payload: null,
    callId: progress.callId,
    callLabel: progress.callLabel,
  });
}

function emitCallCheckpoint(handler: ReviewEventHandler | undefined, stage: ReviewStageName, checkpoint: ReviewCallCheckpoint) {
  const messages = {
    assessment: "优势与问题已就绪，继续生成修改建议",
    priorities: "优先行动已就绪，继续生成逐板块建议",
    rewrite_content: "简历正文已就绪，可查看和下载；继续生成改写说明",
  };
  emit(handler, {
    kind: "stage_checkpoint", stage, phase: null, title: stageTitles[stage],
    message: messages[checkpoint.checkpoint], details: ["已保存小步骤断点"], snippet: "", payload: checkpoint,
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

  // ── Stage 1: Loader ──────────────────────────────────────────────────
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

  // ── Stage 2: Parser (receives Loader output) ─────────────────────────
  throwIfAborted(abortSignal);
  const profile = resumeState.profile ?? (await (async () => {
    emit(eventHandler, {
      kind: "stage_started",
      stage: "resume_parser",
      phase: null,
      title: "解析简历",
      message: "正在抽取候选人画像与缺口",
      details: [
        "已接收 Loader 节点输出 → 简历原始文件文本",
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

  // Scores are a separate checkpoint: visible before any advice request starts.
  throwIfAborted(abortSignal);
  const scoring = resumeState.scoring ?? await (async () => {
    emit(eventHandler, {
      kind: "stage_started", stage: "scoring_agent", phase: null,
      title: "三视角评分", message: "先生成评分与简短证据，完成后立即展示",
      details: ["本次只评分，不生成修改建议；总分由代码按权重计算。"],
      snippet: "", payload: null,
    });
    const scores = await deps.runScoring(
      profile, targetJob,
      (progress) => emitStageProgress(eventHandler, "scoring_agent", progress),
      abortSignal,
    );
    emit(eventHandler, {
      kind: "stage_completed", stage: "scoring_agent", phase: null,
      title: "评分已就绪", message: `加权总分 ${scores.review.overallScore}/100，正在继续生成建议`,
      details: ["HR 35% · 面试官 35% · 职业定位 30%"], snippet: "", payload: scores,
    });
    return scores;
  })();
  if (resumeState.scoring) {
    emitCachedStageCompleted(eventHandler, "scoring_agent", scoring);
  }

  // ── Stage 3: Short advice calls use the already-completed scores ──
  throwIfAborted(abortSignal);
  // Keep successful sibling checkpoints and settle every call before closing the stream.
  const reviewerResults = await Promise.allSettled(
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
      message: `评分已完成，正在从 ${reviewer.perspective} 视角补充最多3条建议`,
        details: [
          "已接收 Parser 节点输出 → 候选人结构化画像与评估维度",
          `已接收目标岗位配置 →【${targetJob.title}】`,
        ],
        snippet: "",
        payload: null,
      });
      const feedback = await reviewer.run(
        profile,
        targetJob,
        (progress) => {
          emitStageProgress(eventHandler, reviewer.name, progress);
        },
        abortSignal,
        scoring.reviewers[reviewer.name],
        resumeState.checkpoints?.[reviewer.name],
        (checkpoint) => emitCallCheckpoint(eventHandler, reviewer.name, checkpoint),
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
  const reviewerFeedback = reviewerResults.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });

  // ── Stage 4: Summary (receives only the 3 agents' feedback) ──────────
  throwIfAborted(abortSignal);
  const finalReview = resumeState.finalReview ?? (await (async () => {
    emit(eventHandler, {
      kind: "stage_started",
      stage: "summary_agent",
      phase: null,
      title: "汇总建议",
      message: "正在去重并整理最多5条修改行动，评分保持不变",
      details: [
        "已接收 HR Agent 输出 → 初筛报告与评估得分",
        "已接收 Interviewer Agent 输出 → 面试评估与评分",
        "已接收 Career Master Agent 输出 → 职业规划与胜任度建议",
      ],
      snippet: "",
      payload: null,
    });
    const review = await deps.runSummary(
      reviewerFeedback,
      targetJob,
      (progress) => {
        emitStageProgress(eventHandler, "summary_agent", progress);
      },
      abortSignal,
      scoring.review,
      resumeState.checkpoints?.summary_agent,
      (checkpoint) => emitCallCheckpoint(eventHandler, "summary_agent", checkpoint),
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

  // ── Stage 5: Rewrite (receives only Summary output + original doc) ───
  throwIfAborted(abortSignal);
  const rewriteResult = resumeState.rewrite ?? (await (async () => {
    emit(eventHandler, {
      kind: "stage_started",
      stage: "rewrite_agent",
      phase: null,
      title: "智能改写简历",
      message: "正在根据终审建议重构简历",
      details: [
        "已接收 Summary Agent 输出 → 终审改写优化指导意见",
        "已接收 Loader 节点输出 → 原始简历文档（作为改写基底）",
      ],
      snippet: "",
      payload: null,
    });
    const rewrite = await deps.runRewrite(
      document,
      finalReview,
      targetJob,
      (progress) => {
        emitStageProgress(eventHandler, "rewrite_agent", progress);
      },
      abortSignal,
      resumeState.checkpoints?.rewrite_agent,
      (checkpoint) => emitCallCheckpoint(eventHandler, "rewrite_agent", checkpoint),
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
