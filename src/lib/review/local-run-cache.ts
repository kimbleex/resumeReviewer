import type { ReviewPipelineResumeState } from "@/lib/review/pipeline";
import {
  resumeDocumentSchema,
  resumeProfileSchema,
  reviewerFeedbackSchema,
  finalResumeReviewSchema,
  resumeRewriteSchema,
  type ReviewRunResult,
} from "@/lib/review/schemas";

export const LOCAL_REVIEW_STAGE_ORDER = [
  "resume_loader",
  "resume_parser",
  "hr_agent",
  "interviewer_agent",
  "career_master_agent",
  "summary_agent",
  "rewrite_agent",
] as const;

export type LocalReviewStageName = (typeof LOCAL_REVIEW_STAGE_ORDER)[number];
export type LocalReviewStageStatus = "pending" | "running" | "done" | "interrupted" | "failed";

export type LocalReviewRunSnapshot = {
  ownerKey: string;
  runId: string;
  resumeFileName: string;
  targetRole: string;
  targetDescription: string;
  stageStatus: Record<LocalReviewStageName, LocalReviewStageStatus>;
  stagePayloads: Partial<Record<LocalReviewStageName, unknown>>;
  stageStreams: Partial<Record<LocalReviewStageName, unknown>>;
  finalResult: ReviewRunResult | null;
  updatedAt: number;
};

const DB_NAME = "resume-review-local-runs";
const DB_VERSION = 1;
const STORE_NAME = "runs";

export function createInitialLocalStageStatus(): Record<LocalReviewStageName, LocalReviewStageStatus> {
  return {
    resume_loader: "pending",
    resume_parser: "pending",
    hr_agent: "pending",
    interviewer_agent: "pending",
    career_master_agent: "pending",
    summary_agent: "pending",
    rewrite_agent: "pending",
  };
}

export function interruptRunningStages(
  stageStatus: Record<LocalReviewStageName, LocalReviewStageStatus>,
): Record<LocalReviewStageName, LocalReviewStageStatus> {
  return LOCAL_REVIEW_STAGE_ORDER.reduce(
    (nextStatus, stage) => ({
      ...nextStatus,
      [stage]: stageStatus[stage] === "running" ? "interrupted" : stageStatus[stage],
    }),
    {} as Record<LocalReviewStageName, LocalReviewStageStatus>,
  );
}

export function failRunningStages(
  stageStatus: Record<LocalReviewStageName, LocalReviewStageStatus>,
): Record<LocalReviewStageName, LocalReviewStageStatus> {
  return LOCAL_REVIEW_STAGE_ORDER.reduce(
    (nextStatus, stage) => ({
      ...nextStatus,
      [stage]: stageStatus[stage] === "running" ? "failed" : stageStatus[stage],
    }),
    {} as Record<LocalReviewStageName, LocalReviewStageStatus>,
  );
}

export function hasReusableReviewState(stagePayloads: Partial<Record<LocalReviewStageName, unknown>>): boolean {
  return Boolean(stagePayloads.resume_loader);
}

export function buildReviewResumeState(options: {
  stagePayloads: Partial<Record<LocalReviewStageName, unknown>>;
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
  stagePayloads: Partial<Record<LocalReviewStageName, unknown>>;
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

    const reviewerFeedback: any[] = [];
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
  } catch (error) {
    console.error("Failed to reconstruct ReviewRunResult from stage payloads:", error);
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
      updatedAt: Date.now(),
    }),
  );
}

export async function loadLocalReviewRun(ownerKey: string): Promise<LocalReviewRunSnapshot | null> {
  if (!canUseIndexedDb()) {
    return null;
  }

  const result = await runStoreTransaction("readonly", (store) => store.get(ownerKey));
  return (result as LocalReviewRunSnapshot | undefined) ?? null;
}

export async function clearLocalReviewRun(ownerKey: string): Promise<void> {
  if (!canUseIndexedDb()) {
    return;
  }

  await runStoreTransaction("readwrite", (store) => store.delete(ownerKey));
}
