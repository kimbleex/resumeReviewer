import { z } from "zod";

import { REVIEWER_RUBRICS, SUMMARY_REVIEWER_WEIGHTS, SUMMARY_RUBRIC } from "@/lib/review/rubrics";
import { finalResumeReviewSchema, getReviewCallCheckpoint, reviewerFeedbackSchema, type FinalResumeReview, type ReviewerFeedback } from "@/lib/review/schemas";
import type { ReviewStageName } from "@/lib/review/stages";

export const REVIEWER_NAMES = ["hr_agent", "interviewer_agent", "career_master_agent"] as const;
export type ReviewerName = (typeof REVIEWER_NAMES)[number];

const dimensionScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  reason: z.string().max(90).describe("一句话引用事实说明得分，不超过90字"),
});
export const expertScoreSchema = z.object({
  scoreBreakdown: z.array(dimensionScoreSchema).length(5),
});

// Partial results are displayable without marking their stage complete.
export function getReviewDisplayPayloads(payloads: Partial<Record<ReviewStageName, unknown>>) {
  return Object.fromEntries(Object.entries(payloads).map(
    ([stage, payload]) => [stage, getReviewCallCheckpoint(payload)?.value ?? payload],
  )) as Partial<Record<ReviewStageName, unknown>>;
}

export function calculateReviewerScore(name: ReviewerName, value: z.infer<typeof expertScoreSchema>): ReviewerFeedback {
  const input = expertScoreSchema.parse(value);
  const scoreBreakdown = input.scoreBreakdown.map((item, index) => ({
    ...item,
    label: REVIEWER_RUBRICS[name][index].label,
  }));
  const overallScore = Math.round(scoreBreakdown.reduce(
    (sum, item, index) => sum + item.score * REVIEWER_RUBRICS[name][index].weight / 100, 0,
  ));
  return reviewerFeedbackSchema.parse({
    agentName: name,
    perspective: { hr_agent: "HR / ATS", interviewer_agent: "Technical Interviewer", career_master_agent: "Career Strategy" }[name],
    overallScore,
    scoreBreakdown,
  });
}

export function calculateSummaryScore(feedback: ReviewerFeedback[]): FinalResumeReview {
  const reviewers = Object.fromEntries(feedback.map((item) => [item.agentName, item]));
  if (REVIEWER_NAMES.some((name) => !reviewers[name])) {
    throw new Error("请先完成三位专家的独立评审。");
  }
  const overallScore = Math.round(REVIEWER_NAMES.reduce(
    (sum, name) => sum + reviewers[name].overallScore * SUMMARY_REVIEWER_WEIGHTS[name] / 100, 0,
  ));
  return finalResumeReviewSchema.parse({
    overallScore,
    readyLevel: overallScore >= 80 ? "strong" : overallScore >= 65 ? "promising" : "needs_rewrite",
    executiveSummary: "三位专家评审已完成，汇总建议将陆续展示。",
    scoreBreakdown: REVIEWER_NAMES.map((name, index) => ({
      label: SUMMARY_RUBRIC[index].label,
      score: reviewers[name].overallScore,
      reason: `按该视角五个维度加权计算，占总分 ${SUMMARY_REVIEWER_WEIGHTS[name]}%。`,
    })),
  });
}
