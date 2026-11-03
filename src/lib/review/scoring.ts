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
const expertScoreSchema = z.object({
  scoreBreakdown: z.array(dimensionScoreSchema).length(5),
});

// Labels, weights and totals are supplied by code, never generated twice.
export const scoringResponseSchema = z.object({
  hr_agent: expertScoreSchema,
  interviewer_agent: expertScoreSchema,
  career_master_agent: expertScoreSchema,
});

export const reviewScoringSchema = z.object({
  reviewers: z.object({
    hr_agent: reviewerFeedbackSchema,
    interviewer_agent: reviewerFeedbackSchema,
    career_master_agent: reviewerFeedbackSchema,
  }),
  review: finalResumeReviewSchema,
});
export type ReviewScoring = z.infer<typeof reviewScoringSchema>;

// Display-only fallback: never put score-only feedback into completion checkpoints.
export function getReviewDisplayPayloads(payloads: Partial<Record<ReviewStageName, unknown>>) {
  const unwrapped = Object.fromEntries(Object.entries(payloads).map(
    ([stage, payload]) => [stage, getReviewCallCheckpoint(payload)?.value ?? payload],
  )) as Partial<Record<ReviewStageName, unknown>>;
  const parsed = reviewScoringSchema.safeParse(payloads.scoring_agent);
  if (!parsed.success) return unwrapped;
  return {
    ...parsed.data.reviewers,
    summary_agent: parsed.data.review,
    ...unwrapped,
  };
}

export function calculateReviewScoring(value: z.infer<typeof scoringResponseSchema>): ReviewScoring {
  const input = scoringResponseSchema.parse(value);
  const reviewers = Object.fromEntries(REVIEWER_NAMES.map((name) => {
    const scoreBreakdown = input[name].scoreBreakdown.map((item, index) => ({
      ...item,
      label: REVIEWER_RUBRICS[name][index].label,
    }));
    const overallScore = Math.round(scoreBreakdown.reduce(
      (sum, item, index) => sum + item.score * REVIEWER_RUBRICS[name][index].weight / 100, 0,
    ));
    return [name, reviewerFeedbackSchema.parse({
      agentName: name,
      perspective: { hr_agent: "HR / ATS", interviewer_agent: "Technical Interviewer", career_master_agent: "Career Strategy" }[name],
      overallScore,
      scoreBreakdown,
    })];
  })) as Record<ReviewerName, ReviewerFeedback>;
  const overallScore = Math.round(REVIEWER_NAMES.reduce(
    (sum, name) => sum + reviewers[name].overallScore * SUMMARY_REVIEWER_WEIGHTS[name] / 100, 0,
  ));
  const review: FinalResumeReview = finalResumeReviewSchema.parse({
    overallScore,
    readyLevel: overallScore >= 80 ? "strong" : overallScore >= 65 ? "promising" : "needs_rewrite",
    executiveSummary: "三视角评分已完成，具体建议将陆续展示。",
    scoreBreakdown: REVIEWER_NAMES.map((name, index) => ({
      label: SUMMARY_RUBRIC[index].label,
      score: reviewers[name].overallScore,
      reason: `按该视角五个维度加权计算，占总分 ${SUMMARY_REVIEWER_WEIGHTS[name]}%。`,
    })),
  });
  return { reviewers, review };
}
