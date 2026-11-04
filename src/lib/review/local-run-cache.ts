import type { ReviewPipelineResumeState } from "@/lib/review/pipeline";
import {
  resumeDocumentSchema,
  resumeProfileSchema,
  reviewerFeedbackSchema,
  finalResumeReviewSchema,
  resumeRewriteSchema,
  type ReviewRunResult,
  getReviewCallCheckpoint,
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
const RECOVERY_KEY = "resume-review-recovery-v1";
let pendingWrite: Promise<unknown> = Promise.resolve();

function readRecoverySnapshot(): LocalReviewRunSnapshot | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(RECOVERY_KEY) : null;
    const snapshot = raw ? JSON.parse(raw) : null;
    return snapshot && typeof snapshot.runId === "string" && typeof snapshot.updatedAt === "number" &&
      snapshot.stagePayloads && snapshot.stageStatus ? snapshot as LocalReviewRunSnapshot : null;
  } catch {
    return null;
  }
}

function replaceRunningStages(
  stageStatus: Record<ReviewStageName, ReviewStageStatus>,
  nextStatus: ReviewStageStatus,
): Record<ReviewStageName, ReviewStageStatus> {
  return Object.fromEntries(
    REVIEW_STAGE_ORDER.map((stage) => [stage, stageStatus[stage] === "running" ? nextStatus : stageStatus[stage] ?? "pending"]),
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
  const completedPayloads = { ...options.stagePayloads };
  for (const stage of REVIEW_STAGE_ORDER) {
    const checkpoint = getReviewCallCheckpoint(completedPayloads[stage]);
    if (checkpoint) {
      (resumeState.checkpoints ??= {})[stage] = checkpoint;
      delete completedPayloads[stage];
    }
  }

  if (completedPayloads.resume_loader) {
    resumeState.document = completedPayloads.resume_loader as ReviewPipelineResumeState["document"];
  }
  if (completedPayloads.resume_parser) {
    resumeState.profile = completedPayloads.resume_parser as ReviewPipelineResumeState["profile"];
  }
  if (completedPayloads.hr_agent) {
    reviewerFeedback.hr_agent = completedPayloads.hr_agent as NonNullable<ReviewPipelineResumeState["reviewerFeedback"]>["hr_agent"];
  }
  if (completedPayloads.interviewer_agent) {
    reviewerFeedback.interviewer_agent = completedPayloads
      .interviewer_agent as NonNullable<ReviewPipelineResumeState["reviewerFeedback"]>["interviewer_agent"];
  }
  if (completedPayloads.career_master_agent) {
    reviewerFeedback.career_master_agent = completedPayloads
      .career_master_agent as NonNullable<ReviewPipelineResumeState["reviewerFeedback"]>["career_master_agent"];
  }
  if (Object.keys(reviewerFeedback).length > 0) {
    resumeState.reviewerFeedback = reviewerFeedback;
  }
  if (options.finalResult?.finalReview || completedPayloads.summary_agent) {
    resumeState.finalReview = (options.finalResult?.finalReview ??
      completedPayloads.summary_agent) as ReviewPipelineResumeState["finalReview"];
  }
  if (options.finalResult?.rewrite || completedPayloads.rewrite_agent) {
    resumeState.rewrite = (options.finalResult?.rewrite ?? completedPayloads.rewrite_agent) as ReviewPipelineResumeState["rewrite"];
  }

  return resumeState;
}

export function tryReconstructReviewRunResult(options: {
  targetRole: string;
  targetDescription: string;
  stagePayloads: Partial<Record<ReviewStageName, unknown>>;
}): ReviewRunResult | null {
  const { stagePayloads, targetRole, targetDescription } = options;
  if (Object.values(stagePayloads).some((payload) => getReviewCallCheckpoint(payload))) return null;
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
        let result: T;

        request.onerror = () => reject(request.error);
        request.onsuccess = () => { result = request.result; };
        transaction.oncomplete = () => {
          db.close();
          resolve(result);
        };
        transaction.onerror = transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      }),
  );
}

export async function saveLocalReviewRun(snapshot: LocalReviewRunSnapshot): Promise<void> {
  // Synchronous recovery copy closes the refresh window before an IndexedDB commit.
  let recoverySaved = false;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(RECOVERY_KEY, JSON.stringify(snapshot));
      recoverySaved = true;
    }
  } catch {
    // IndexedDB can still save a snapshot when localStorage is full or disabled.
  }
  if (!canUseIndexedDb()) {
    if (!recoverySaved) throw new Error("无法保存本地断点，请先下载已生成的 Markdown。");
    return;
  }

  // Preserve event order even if separate database opens complete out of order.
  const write = pendingWrite.catch(() => undefined).then(() =>
    runStoreTransaction("readwrite", (store) => store.put({ ...snapshot, ownerKey: LOCAL_OWNER_KEY })),
  );
  pendingWrite = write;
  try {
    await write;
  } catch (error) {
    if (!recoverySaved) throw error;
  }
}

export async function loadLocalReviewRun(): Promise<LocalReviewRunSnapshot | null> {
  const recovery = readRecoverySnapshot();
  if (!canUseIndexedDb()) return recovery;
  try {
    const result = await runStoreTransaction("readonly", (store) => store.get(LOCAL_OWNER_KEY)) as LocalReviewRunSnapshot | undefined;
    return recovery && (!result || recovery.updatedAt >= result.updatedAt) ? recovery : result ?? null;
  } catch {
    return recovery;
  }
}
