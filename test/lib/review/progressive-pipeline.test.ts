import assert from "node:assert/strict";
import test from "node:test";

import { invokeTextAgent } from "@/lib/agents/base";
import { reviewerAgents } from "@/lib/agents/workflow/reviewers";
import { runRewriteAgent } from "@/lib/agents/workflow/rewrite";
import { runWithLlmConfig } from "@/lib/llm/model";
import { buildReviewResumeState, tryReconstructReviewRunResult } from "@/lib/review/local-run-cache";
import { runReviewPipeline } from "@/lib/review/pipeline";
import { calculateReviewerScore, calculateSummaryScore, expertScoreSchema, getReviewDisplayPayloads } from "@/lib/review/scoring";
import { resumeProfileSchema, type ReviewStageEvent, type ReviewCallCheckpoint } from "@/lib/review/schemas";
import type { ReviewStageName } from "@/lib/review/stages";

const config = { protocol: "chat" as const, baseUrl: "https://example.test/v1", apiKey: "test", modelName: "test-model" };
const scoreInput = {
  hr_agent: { scoreBreakdown: [80, 60, 70, 90, 50].map((score) => ({ score, reason: "简历中的项目证据" })) },
  interviewer_agent: { scoreBreakdown: Array.from({ length: 5 }, () => ({ score: 80, reason: "简历中的技术证据" })) },
  career_master_agent: { scoreBreakdown: Array.from({ length: 5 }, () => ({ score: 60, reason: "简历中的职业证据" })) },
};
const profile = resumeProfileSchema.parse({ candidateName: "Ada", headline: "工程师" });
const advice = {
  reasoningSummary: ["补齐项目证据"],
  strengths: ["有明确技术主线"],
  concerns: ["缺少成果依据"],
  suggestions: [{ section: "项目", priority: "high", issue: "缺少成果", recommendation: "补充可验证的成果" }],
};
const summary = {
  executiveSummary: "先补齐成果证据，再调整表达。",
  reasoningSummary: ["三视角建议已去重"],
  topPriorities: ["补齐成果证据"],
  sectionRevisions: advice.suggestions,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function chatStream(text: string, finishReason = "stop") {
  const chunk = (delta: unknown, finish_reason: string | null) => ({
    id: "test", object: "chat.completion.chunk", created: 1, model: "test-model",
    choices: [{ index: 0, delta, finish_reason }],
  });
  return new Response([
    chunk({ role: "assistant", content: text }, null),
    { ...chunk({}, finishReason), usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, completion_tokens_details: { reasoning_tokens: 20 } } },
  ].map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
}

test("weighted scores are deterministic and incomplete scoring cannot become a checkpoint", () => {
  const reviewers = reviewerAgents.map(({ name }) => calculateReviewerScore(name, scoreInput[name]));
  const review = calculateSummaryScore(reviewers);
  assert.equal(reviewers[0].overallScore, 72);
  assert.equal(review.overallScore, 71);
  assert.equal(review.readyLevel, "promising");
  assert.equal(expertScoreSchema.safeParse({ scoreBreakdown: scoreInput.hr_agent.scoreBreakdown.slice(1) }).success, false);
  assert.throws(() => calculateSummaryScore(reviewers.slice(1)), /独立评审/);
});

test("reviewers publish independent score and advice checkpoints, then resume only unfinished calls", async (t) => {
  const hrAssessmentStarted = deferred();
  const releaseOtherScores = deferred();
  const adviceStarted = deferred();
  const releaseAdvice = deferred();
  const events: ReviewStageEvent[] = [];
  const payloads: Partial<Record<ReviewStageName, unknown>> = {};
  const requests: Array<{ name: string; budget: number | undefined; body: string }> = [];
  let adviceRequests = 0;
  let failAdvice = true;

  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const name = body.response_format?.json_schema?.name ?? (JSON.stringify(body.messages).includes("[EXPLANATION]") ? "rewrite_explanation" : "rewrite_content");
    requests.push({ name, budget: body.max_tokens ?? body.max_completion_tokens, body: String(init.body) });
    if (name.endsWith("_score")) {
      const reviewer = name.slice(0, -"_score".length) as keyof typeof scoreInput;
      assert.ok(reviewer in scoreInput);
      assert.doesNotMatch(body.messages[0].content, /三个视角评分/);
      if (reviewer !== "hr_agent") await releaseOtherScores.promise;
      return chatStream(JSON.stringify(scoreInput[reviewer]));
    }
    if (name.endsWith("_assessment")) {
      if (name === "hr_agent_assessment") hrAssessmentStarted.resolve();
      adviceRequests++;
      if (adviceRequests === 3) adviceStarted.resolve();
      await releaseAdvice.promise;
      return chatStream(JSON.stringify({ reasoningSummary: advice.reasoningSummary, strengths: advice.strengths, concerns: advice.concerns }));
    }
    if (name.endsWith("_suggestions")) {
      if (failAdvice && name === "hr_agent_suggestions") return chatStream('{"incomplete":', "length");
      return chatStream(JSON.stringify({ suggestions: advice.suggestions }));
    }
    if (name === "resume_parser") return chatStream(JSON.stringify(profile));
    if (name === "summary_priorities") return chatStream(JSON.stringify({ executiveSummary: summary.executiveSummary, reasoningSummary: summary.reasoningSummary, topPriorities: summary.topPriorities }));
    if (name === "summary_revisions") {
      assert.equal((payloads.summary_agent as ReviewCallCheckpoint).checkpoint, "priorities");
      assert.deepEqual(buildReviewResumeState({ stagePayloads: payloads, finalResult: null }).checkpoints?.summary_agent,
        payloads.summary_agent, "summary priorities must be saved before requesting section revisions");
      return chatStream(JSON.stringify({ sectionRevisions: summary.sectionRevisions }));
    }
    if (name === "rewrite_explanation") {
      assert.equal((payloads.rewrite_agent as ReviewCallCheckpoint).checkpoint, "rewrite_content");
    }
    return chatStream("[REWRITTEN_CONTENT]\n# Ada\n工程师\n[/REWRITTEN_CONTENT]\n[EXPLANATION]\n精简表达\n[/EXPLANATION]");
  });
  const input = { resumeFile: new File(["Ada 工程师"], "resume.txt"), targetJob: { title: "工程师", description: "" } };
  const handler = (event: ReviewStageEvent) => {
    events.push(event);
    if (event.kind === "stage_completed" || event.kind === "stage_checkpoint") payloads[event.stage as ReviewStageName] = event.payload;
  };
  const firstRun = runWithLlmConfig(config, () => runReviewPipeline(input, handler));
  const failedRun = assert.rejects(firstRun, /截断/);
  try {
    await hrAssessmentStarted.promise;
    assert.equal((payloads.hr_agent as ReviewCallCheckpoint).checkpoint, "score");
    assert.equal(payloads.interviewer_agent, undefined, "HR must display without waiting for other scores");
    assert.equal(payloads.career_master_agent, undefined);
    assert.equal(payloads.summary_agent, undefined);
    const display = getReviewDisplayPayloads(payloads);
    assert.equal((display.hr_agent as { overallScore: number }).overallScore, 72);
    assert.equal(display.summary_agent, undefined, "do not invent a combined score before all reviewers finish");
    const checkpoint = buildReviewResumeState({ stagePayloads: payloads, finalResult: null });
    assert.equal(checkpoint.checkpoints?.hr_agent?.checkpoint, "score");
    assert.equal(checkpoint.reviewerFeedback, undefined, "score previews must not masquerade as completed advice");
    assert.ok(events.some((event) => event.stage === "hr_agent" && event.callId && event.callLabel === "HR / ATS · 评分"));
    releaseOtherScores.resolve();
    await adviceStarted.promise;
    for (const stage of ["hr_agent", "interviewer_agent", "career_master_agent"] as const) {
      assert.equal((payloads[stage] as ReviewCallCheckpoint).checkpoint, "score");
    }
  } finally {
    releaseOtherScores.resolve();
    releaseAdvice.resolve();
  }
  await failedRun;
  failAdvice = false;
  const checkpoint = buildReviewResumeState({ stagePayloads: payloads, finalResult: null });
  assert.equal(checkpoint.checkpoints?.hr_agent?.checkpoint, "assessment");
  assert.ok(checkpoint.reviewerFeedback?.interviewer_agent, "successful sibling must survive a failed call");
  assert.ok(checkpoint.reviewerFeedback?.career_master_agent);
  const result = await runWithLlmConfig(config, () => runReviewPipeline(input, handler, {}, { resumeState: checkpoint }));
  assert.equal(result.finalReview.overallScore, 71);
  assert.equal(result.reviewerFeedback[0].overallScore, 72);
  assert.equal(result.reviewerFeedback[0].suggestions.length, 1);
  assert.equal(result.finalReview.sectionRevisions.length, 1);
  assert.match(result.rewrite?.rewrittenContent ?? "", /Ada/);
  assert.equal(requests.filter((request) => request.name === "resume_parser").length, 1);
  assert.equal(requests.filter((request) => request.name.endsWith("_score")).length, 3);
  assert.ok(requests.every((request) => request.budget === undefined), "application must not set output token limits");
  assert.equal(requests.filter((request) => request.name === "hr_agent_assessment").length, 1);
  assert.equal(requests.filter((request) => request.name === "hr_agent_suggestions").length, 2);
  assert.equal(requests.filter((request) => request.name === "interviewer_agent_suggestions").length, 1);
  assert.ok(requests.filter((request) => /hr_agent_(assessment|suggestions)/.test(request.name)).every((request) => request.body.includes("72")));
  assert.ok(events.some((event) => event.details.some((detail) => detail.includes("输出 200 token"))));
  const callIds = new Set(events.filter((event) => event.phase === "requesting_model").map((event) => event.callId));
  assert.equal(callIds.size, requests.length);
  assert.ok(events.every((event) => event.stage !== "scoring_agent"));
});

test("a score checkpoint resumes assessment without rescoring", async (t) => {
  let checkpoint: ReviewCallCheckpoint | undefined;
  const names: string[] = [];
  let failAssessment = true;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const name = body.response_format.json_schema.name;
    names.push(name);
    if (name === "hr_agent_score") return chatStream(JSON.stringify(scoreInput.hr_agent));
    if (name === "hr_agent_assessment") {
      assert.equal(checkpoint?.checkpoint, "score");
      return failAssessment ? chatStream('{"incomplete":', "length") : chatStream(JSON.stringify({
        reasoningSummary: advice.reasoningSummary, strengths: advice.strengths, concerns: advice.concerns,
      }));
    }
    assert.equal(checkpoint?.checkpoint, "assessment");
    assert.deepEqual(getReviewDisplayPayloads({ hr_agent: checkpoint }).hr_agent, checkpoint.value);
    return chatStream(JSON.stringify({ suggestions: advice.suggestions }));
  });
  const run = () => runWithLlmConfig(config, () => reviewerAgents[0].run(
    profile, { title: "工程师", description: "" }, undefined, undefined, checkpoint,
    (value) => { checkpoint = value; },
  ));
  await assert.rejects(run(), /截断/);
  failAssessment = false;
  const result = await run();
  assert.equal(result.overallScore, 72);
  assert.equal(result.suggestions.length, 1);
  assert.deepEqual(names, ["hr_agent_score", "hr_agent_assessment", "hr_agent_assessment", "hr_agent_suggestions"]);
});

test("truncated rewrite is rejected instead of saved as a completed resume", async (t) => {
  t.mock.method(globalThis, "fetch", async () => chatStream("# incomplete resume", "length"));
  await assert.rejects(
    runWithLlmConfig(config, () => invokeTextAgent({
      name: "rewrite_agent", systemPrompt: "rewrite", userContent: "resume",
    })),
    /截断/,
  );
});

test("resume body is available before its explanation and survives an explanation failure", async (t) => {
  let checkpoint: ReviewCallCheckpoint | undefined;
  let bodyCalls = 0;
  let explanationCalls = 0;
  const review = calculateSummaryScore(reviewerAgents.map(({ name }) => calculateReviewerScore(name, scoreInput[name])));
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (JSON.stringify(body.messages).includes("[EXPLANATION]")) {
      explanationCalls++;
      assert.equal(checkpoint?.checkpoint, "rewrite_content", "body must be published before explanation is requested");
      return explanationCalls === 1 ? chatStream("missing tags") : chatStream("[EXPLANATION]精简表达[/EXPLANATION]");
    }
    bodyCalls++;
    return chatStream("[REWRITTEN_CONTENT]# Ada\n工程师[/REWRITTEN_CONTENT]");
  });
  const document = { path: "resume.txt", fileType: "txt", content: "Ada 工程师" };
  const run = () => runWithLlmConfig(config, () => runRewriteAgent(
    document, review, { title: "工程师", description: "" },
    undefined, undefined, checkpoint, (value) => { checkpoint = value; },
  ));
  await assert.rejects(run(), /改写说明不完整/);
  const payloads = {
    resume_loader: document, resume_parser: profile,
    summary_agent: review, rewrite_agent: checkpoint,
  };
  assert.equal(buildReviewResumeState({ stagePayloads: payloads, finalResult: null }).rewrite, undefined);
  assert.equal(tryReconstructReviewRunResult({
    stagePayloads: payloads, targetRole: "工程师", targetDescription: "",
  }), null, "partial rewrite cannot restore a finished pipeline");
  const result = await run();
  assert.equal(result.rewrittenContent, "# Ada\n工程师");
  assert.equal(result.explanation, "精简表达");
  assert.equal(bodyCalls, 1);
  assert.equal(explanationCalls, 2);
});
