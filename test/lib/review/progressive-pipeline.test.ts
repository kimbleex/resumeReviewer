import assert from "node:assert/strict";
import test from "node:test";

import { invokeTextAgent } from "@/lib/agents/base";
import { runRewriteAgent } from "@/lib/agents/workflow/rewrite";
import { runWithLlmConfig } from "@/lib/llm/model";
import { buildReviewResumeState, tryReconstructReviewRunResult } from "@/lib/review/local-run-cache";
import { runReviewPipeline } from "@/lib/review/pipeline";
import { calculateReviewScoring, getReviewDisplayPayloads, scoringResponseSchema } from "@/lib/review/scoring";
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
  const scores = calculateReviewScoring(scoreInput);
  assert.equal(scores.reviewers.hr_agent.overallScore, 72);
  assert.equal(scores.review.overallScore, 71);
  assert.equal(scores.review.readyLevel, "promising");
  assert.equal(scoringResponseSchema.safeParse({
    ...scoreInput, hr_agent: { scoreBreakdown: scoreInput.hr_agent.scoreBreakdown.slice(1) },
  }).success, false);
});

test("real agent calls publish scores before advice, then resume without regenerating scores", async (t) => {
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
    if (name.endsWith("_assessment")) {
      adviceRequests++;
      if (adviceRequests === 3) adviceStarted.resolve();
      await releaseAdvice.promise;
      return chatStream(JSON.stringify({ reasoningSummary: advice.reasoningSummary, strengths: advice.strengths, concerns: advice.concerns }));
    }
    if (name.endsWith("_suggestions")) {
      if (failAdvice) return chatStream('{"incomplete":', "length");
      return chatStream(JSON.stringify({ suggestions: advice.suggestions }));
    }
    if (name === "resume_parser") return chatStream(JSON.stringify(profile));
    if (name === "scoring_agent") return chatStream(JSON.stringify(scoreInput));
    if (name === "summary_priorities") return chatStream(JSON.stringify({ executiveSummary: summary.executiveSummary, reasoningSummary: summary.reasoningSummary, topPriorities: summary.topPriorities }));
    if (name === "summary_revisions") return chatStream(JSON.stringify({ sectionRevisions: summary.sectionRevisions }));
    return chatStream("[REWRITTEN_CONTENT]\n# Ada\n工程师\n[/REWRITTEN_CONTENT]\n[EXPLANATION]\n精简表达\n[/EXPLANATION]");
  });
  const input = { resumeFile: new File(["Ada 工程师"], "resume.txt"), targetJob: { title: "工程师", description: "" } };
  const handler = (event: ReviewStageEvent) => {
    events.push(event);
    if (event.kind === "stage_completed" || event.kind === "stage_checkpoint") payloads[event.stage as ReviewStageName] = event.payload;
  };
  const firstRun = runWithLlmConfig(config, () => runReviewPipeline(input, handler));
  // Attach the rejection handler immediately so a failed assertion cannot leave an unhandled rejection.
  const failedRun = assert.rejects(firstRun, /截断/);
  try {
    await adviceStarted.promise;
    assert.ok(payloads.scoring_agent);
    assert.equal(payloads.hr_agent, undefined);
    assert.equal(payloads.summary_agent, undefined);
    const display = getReviewDisplayPayloads(payloads);
    assert.equal((display.hr_agent as { overallScore: number }).overallScore, 72);
    assert.equal((display.summary_agent as { overallScore: number }).overallScore, 71);
    const checkpoint = buildReviewResumeState({ stagePayloads: payloads, finalResult: null });
    assert.ok(checkpoint.scoring);
    assert.equal(checkpoint.reviewerFeedback, undefined, "score previews must not masquerade as completed advice");
    assert.ok(events.some((event) => event.stage === "scoring_agent" && event.callId && event.callLabel === "三视角评分"));
  } finally {
    releaseAdvice.resolve();
  }
  await failedRun;
  failAdvice = false;
  const checkpoint = buildReviewResumeState({ stagePayloads: payloads, finalResult: null });
  assert.equal(checkpoint.checkpoints?.hr_agent?.checkpoint, "assessment");
  assert.equal(checkpoint.reviewerFeedback, undefined);
  const result = await runWithLlmConfig(config, () => runReviewPipeline(input, handler, {}, { resumeState: checkpoint }));
  assert.equal(result.finalReview.overallScore, 71);
  assert.equal(result.reviewerFeedback[0].overallScore, 72);
  assert.equal(result.reviewerFeedback[0].suggestions.length, 1);
  assert.equal(result.finalReview.sectionRevisions.length, 1);
  assert.match(result.rewrite?.rewrittenContent ?? "", /Ada/);
  assert.equal(requests.filter((request) => request.name === "resume_parser").length, 1);
  assert.equal(requests.filter((request) => request.name === "scoring_agent").length, 1);
  assert.ok(requests.every((request) => request.budget === undefined), "application must not set output token limits");
  assert.equal(requests.filter((request) => request.name === "hr_agent_assessment").length, 1);
  assert.equal(requests.filter((request) => request.name === "hr_agent_suggestions").length, 2);
  assert.ok(requests.filter((request) => request.name.startsWith("hr_agent")).every((request) => request.body.includes("72")));
  assert.ok(events.some((event) => event.details.some((detail) => detail.includes("输出 200 token"))));
  const callIds = new Set(events.filter((event) => event.phase === "requesting_model").map((event) => event.callId));
  assert.equal(callIds.size, requests.length);
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
  const scoring = calculateReviewScoring(scoreInput);
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
    document, scoring.review, { title: "工程师", description: "" },
    undefined, undefined, checkpoint, (value) => { checkpoint = value; },
  ));
  await assert.rejects(run(), /改写说明不完整/);
  const payloads = {
    resume_loader: document, resume_parser: profile, scoring_agent: scoring,
    summary_agent: scoring.review, rewrite_agent: checkpoint,
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
