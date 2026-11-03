// 评审流水线的节点顺序与状态，前后端共用。
export const REVIEW_STAGE_ORDER = [
  "resume_loader",
  "resume_parser",
  "scoring_agent",
  "hr_agent",
  "interviewer_agent",
  "career_master_agent",
  "summary_agent",
  "rewrite_agent",
] as const;

export type ReviewStageName = (typeof REVIEW_STAGE_ORDER)[number];
export type ReviewStageStatus = "pending" | "running" | "done" | "interrupted" | "failed";

export function createInitialStageStatus(): Record<ReviewStageName, ReviewStageStatus> {
  return Object.fromEntries(REVIEW_STAGE_ORDER.map((stage) => [stage, "pending"])) as Record<
    ReviewStageName,
    ReviewStageStatus
  >;
}
