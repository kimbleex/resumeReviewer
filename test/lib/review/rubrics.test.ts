import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCareerMasterPrompt, buildHrPrompt, buildInterviewerPrompt, buildSummaryPrompt } from "@/lib/agents/workflow/prompts";
import { REVIEWER_RUBRICS, SUMMARY_REVIEWER_WEIGHTS, SUMMARY_RUBRIC, applyRubricWeights, scoreBand } from "@/lib/review/rubrics";

test("every rubric's weights sum to 100", () => {
  for (const rubric of [...Object.values(REVIEWER_RUBRICS), SUMMARY_RUBRIC]) {
    assert.equal(rubric.reduce((sum, dimension) => sum + dimension.weight, 0), 100);
  }
  assert.equal(Object.values(SUMMARY_REVIEWER_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100);
});

test("prompts are generated from the shared rubric definitions", () => {
  const prompts = {
    hr_agent: buildHrPrompt(),
    interviewer_agent: buildInterviewerPrompt(),
    career_master_agent: buildCareerMasterPrompt(),
  } as const;

  for (const [stage, prompt] of Object.entries(prompts)) {
    for (const dimension of REVIEWER_RUBRICS[stage as keyof typeof prompts]) {
      assert.ok(prompt.includes(`${dimension.label}（权重 ${dimension.weight}%）`), `${stage} prompt misses ${dimension.label}`);
    }
    assert.match(prompt, /expectedGain/);
  }

  const summaryPrompt = buildSummaryPrompt();
  for (const dimension of SUMMARY_RUBRIC) {
    assert.ok(summaryPrompt.includes(`${dimension.label}（权重 ${dimension.weight}%）`));
  }
});

test("applyRubricWeights matches dimensions by name and computes weighted contributions", () => {
  const rubric = REVIEWER_RUBRICS.hr_agent;
  const { rows, dimensionScores, weightedTotal, coveredWeight } = applyRubricWeights(
    [
      { label: "业务价值与量化成果", score: 60, reason: "" },
      { label: "岗位匹配度与关键词覆盖", score: 80, reason: "" },
      { label: "其他自定义维度", score: 90, reason: "" },
    ],
    rubric,
  );

  assert.equal(rows[0].weight, 25);
  assert.equal(rows[0].contribution, 15);
  assert.equal(rows[0].weightedGap, 10);
  assert.equal(rows[1].weight, 30);
  assert.equal(rows[2].weight, null);
  assert.deepEqual(dimensionScores, [80, 60, null, null, null]);
  assert.equal(coveredWeight, 55);
  assert.equal(weightedTotal, 70.9);
});

test("applyRubricWeights falls back to positional matching when labels differ but counts align", () => {
  const rubric = SUMMARY_RUBRIC;
  const { rows, weightedTotal } = applyRubricWeights(
    [
      { label: "ATS", score: 70, reason: "" },
      { label: "Tech", score: 80, reason: "" },
      { label: "Career", score: 60, reason: "" },
    ],
    rubric,
  );

  assert.deepEqual(rows.map((row) => row.weight), [35, 35, 30]);
  assert.equal(weightedTotal, 70.5);
});

test("scoreBand maps scores onto the calibration anchors", () => {
  assert.equal(scoreBand(95).label, "行业标杆");
  assert.equal(scoreBand(80).label, "强");
  assert.equal(scoreBand(64).label, "及格");
  assert.equal(scoreBand(10).label, "不具竞争力");
});
