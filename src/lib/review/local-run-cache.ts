import type { ReviewPipelineResumeState } from "@/lib/review/pipeline";
import {
  resumeDocumentSchema,
  resumeProfileSchema,
  reviewerFeedbackSchema,
  finalResumeReviewSchema,
  resumeRewriteSchema,
  type ReviewRunResult,
} from "@/lib/review/schemas";
import { REVIEW_STAGE_ORDER, type ReviewStageName, type ReviewStageStatus } from "@/lib/review/stages";

export type LocalReviewRunSnapshot = {
  runId: string;
  resumeFileName: string;
  targetRole: string;
  targetDescription: string;
  stageStatus: Record<ReviewStageName, ReviewStageStatus>;
  stagePayloads: Partial<Record<ReviewStageName, unknown>>;
  stageStreams: Partial<Record<ReviewStageName, unknown>>;
  finalResult: ReviewRunResult | null;
  updatedAt: number;
};

const DB_NAME = "resume-review-local-runs";
const DB_VERSION = 1;
const STORE_NAME = "runs";
// 无登录体系后只保留当前浏览器的一份断点记录。
const LOCAL_OWNER_KEY = "local";

function replaceRunningStages(
  stageStatus: Record<ReviewStageName, ReviewStageStatus>,
  nextStatus: ReviewStageStatus,
): Record<ReviewStageName, ReviewStageStatus> {
  return Object.fromEntries(
    REVIEW_STAGE_ORDER.map((stage) => [stage, stageStatus[stage] === "running" ? nextStatus : stageStatus[stage]]),
  ) as Record<ReviewStageName, ReviewStageStatus>;
}

export function interruptRunningStages(stageStatus: Record<ReviewStageName, ReviewStageStatus>) {
  return replaceRunningStages(stageStatus, "interrupted");
}

export function failRunningStages(stageStatus: Record<ReviewStageName, ReviewStageStatus>) {
  return replaceRunningStages(stageStatus, "failed");
}

export function hasReusableReviewState(stagePayloads: Partial<Record<ReviewStageName, unknown>>): boolean {
  return Boolean(stagePayloads.resume_loader);
}

export function buildReviewResumeState(options: {
  stagePayloads: Partial<Record<ReviewStageName, unknown>>;
  finalResult: ReviewRunResult | null;
}): ReviewPipelineResumeState {
  const resumeState: ReviewPipelineResumeState = {};
  const reviewerFeedback: NonNullable<ReviewPipelineResumeState["reviewerFeedback"]> = {};

  if (options.stagePayloads.resume_loader) {
    resumeState.document = options.stagePayloads.resume_loader as ReviewPipelineResumeState["document"];
  }
  if (options.stagePayloads.resume_parser) {
    resumeState.profile = options.stagePayloads.resume_parser as ReviewPipelineResumeState["profile"];
  }
  if (options.stagePayloads.hr_agent) {
    reviewerFeedback.hr_agent = options.stagePayloads.hr_agent as NonNullable<ReviewPipelineResumeState["reviewerFeedback"]>["hr_agent"];
  }
  if (options.stagePayloads.interviewer_agent) {
    reviewerFeedback.interviewer_agent = options.stagePayloads
      .interviewer_agent as NonNullable<ReviewPipelineResumeState["reviewerFeedback"]>["interviewer_agent"];
  }
  if (options.stagePayloads.career_master_agent) {
    reviewerFeedback.career_master_agent = options.stagePayloads
      .career_master_agent as NonNullable<ReviewPipelineResumeState["reviewerFeedback"]>["career_master_agent"];
  }
  if (Object.keys(reviewerFeedback).length > 0) {
    resumeState.reviewerFeedback = reviewerFeedback;
  }
  if (options.finalResult?.finalReview || options.stagePayloads.summary_agent) {
    resumeState.finalReview = (options.finalResult?.finalReview ??
      options.stagePayloads.summary_agent) as ReviewPipelineResumeState["finalReview"];
  }
  if (options.finalResult?.rewrite || options.stagePayloads.rewrite_agent) {
    resumeState.rewrite = (options.finalResult?.rewrite ?? options.stagePayloads.rewrite_agent) as ReviewPipelineResumeState["rewrite"];
  }

  return resumeState;
}

export function tryReconstructReviewRunResult(options: {
  targetRole: string;
  targetDescription: string;
  stagePayloads: Partial<Record<ReviewStageName, unknown>>;
}): ReviewRunResult | null {
  const { stagePayloads, targetRole, targetDescription } = options;
  if (
    !stagePayloads.resume_loader ||
    !stagePayloads.resume_parser ||
    !stagePayloads.summary_agent ||
    !stagePayloads.rewrite_agent
  ) {
    return null;
  }

  try {
    const document = resumeDocumentSchema.parse(stagePayloads.resume_loader);
    const profile = resumeProfileSchema.parse(stagePayloads.resume_parser);
    const finalReview = finalResumeReviewSchema.parse(stagePayloads.summary_agent);
    const rewrite = resumeRewriteSchema.parse(stagePayloads.rewrite_agent);

    const reviewerFeedback: ReviewRunResult["reviewerFeedback"] = [];
    if (stagePayloads.hr_agent) {
      reviewerFeedback.push(reviewerFeedbackSchema.parse(stagePayloads.hr_agent));
    }
    if (stagePayloads.interviewer_agent) {
      reviewerFeedback.push(reviewerFeedbackSchema.parse(stagePayloads.interviewer_agent));
    }
    if (stagePayloads.career_master_agent) {
      reviewerFeedback.push(reviewerFeedbackSchema.parse(stagePayloads.career_master_agent));
    }

    return {
      document,
      targetJob: {
        title: targetRole,
        description: targetDescription,
      },
      profile,
      reviewerFeedback,
      finalReview,
      rewrite,
    };
  } catch {
    return null;
  }
}

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openLocalRunDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "ownerKey" });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function runStoreTransaction<T>(mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  if (!canUseIndexedDb()) {
    return Promise.reject(new Error("IndexedDB is not available."));
  }

  return openLocalRunDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = callback(transaction.objectStore(STORE_NAME));

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      }),
  );
}

export async function saveLocalReviewRun(snapshot: LocalReviewRunSnapshot): Promise<void> {
  if (!canUseIndexedDb()) {
    return;
  }

  await runStoreTransaction("readwrite", (store) =>
    store.put({
      ...snapshot,
      ownerKey: LOCAL_OWNER_KEY,
      updatedAt: Date.now(),
    }),
  );
}

export async function loadLocalReviewRun(): Promise<LocalReviewRunSnapshot | null> {
  if (!canUseIndexedDb()) {
    return null;
  }

  const result = await runStoreTransaction("readonly", (store) => store.get(LOCAL_OWNER_KEY));
  return (result as LocalReviewRunSnapshot | undefined) ?? null;
}
