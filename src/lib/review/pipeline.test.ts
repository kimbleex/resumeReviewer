import assert from "node:assert/strict";
import test from "node:test";

import { runReviewPipeline } from "./pipeline";
import type { ResumeDocument, ResumeProfile, ReviewStageEvent, ReviewerFeedback, TargetJob } from "./schemas";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

test("runReviewPipeline runs stages in the expected order", async () => {
  const events: Array<{ kind: string; stage: string }> = [];
  const resumeFile = new File(["Backend engineer with Python and LangChain experience."], "resume.txt", {
    type: "text/plain",
  });
  const targetJob: TargetJob = { title: "AI Backend Engineer", description: "" };
  const reviewerStarted = createDeferred<void>();
  const reviewerRelease = createDeferred<void>();
  const startedReviewers: string[] = [];

  const document: ResumeDocument = {
    path: "upload://resume.txt",
    fileType: "txt",
    content: "Backend engineer with Python and LangChain experience.",
  };

  const profile: ResumeProfile = {
    candidateName: "Alex",
    personalInfo: { name: "Alex", age: "", phone: "", email: "", location: "", links: [] },
    headline: "AI Backend Engineer",
    targetRoles: ["AI Backend Engineer"],
    yearsOfExperience: "5+ years",
    coreSkills: ["Python", "LangChain"],
    skillGroups: [],
    workExperiences: [],
    projects: [],
    educationRecords: [],
    strengths: ["Strong backend ownership"],
    risks: ["Missing metrics"],
    missingInformation: ["Target industry"],
    reasoningSummary: ["Parsed technical focus from project descriptions."],
  };

  const reviewerFeedback: ReviewerFeedback = {
    agentName: "hr_agent",
    perspective: "HR",
    overallScore: 78,
    reasoningSummary: ["Focused on recruiter readability."],
    strengths: ["Readable project titles"],
    concerns: ["Needs stronger metrics"],
    scoreBreakdown: [],
    suggestions: [],
  };

  const gateReviewer = async (agentName: string, perspective: string) => {
    startedReviewers.push(agentName);
    if (startedReviewers.length === 3) {
      reviewerStarted.resolve();
    }
    await reviewerRelease.promise;
    return { ...reviewerFeedback, agentName, perspective };
  };

  const pipelinePromise = runReviewPipeline(
    { resumeFile, targetJob },
    (event) => {
      events.push({ kind: event.kind, stage: event.stage });
    },
    {
      loadResume: async () => document,
      runResumeParser: async () => profile,
      reviewerAgents: [
        { name: "hr_agent", perspective: "HR", run: async () => gateReviewer("hr_agent", "HR") },
        {
          name: "interviewer_agent",
          perspective: "Interviewer",
          run: async () => gateReviewer("interviewer_agent", "Interviewer"),
        },
        {
          name: "career_master_agent",
          perspective: "Career Master",
          run: async () => gateReviewer("career_master_agent", "Career Master"),
        },
      ],
      runSummary: async () => ({
        overallScore: 82,
        readyLevel: "promising",
        executiveSummary: "The resume is technically credible but needs stronger positioning.",
        reasoningSummary: ["Merged reviewer overlap and prioritized high-signal edits."],
        topPriorities: ["Quantify project impact."],
        scoreBreakdown: [],
        sectionRevisions: [],
      }),
      runRewrite: async () => ({
        rewrittenContent: "# Alex\n\nRewritten resume content.",
        explanation: "Applied summary guidance to produce the final resume.",
      }),
    },
  );

  await reviewerStarted.promise;

  assert.deepEqual(startedReviewers, ["hr_agent", "interviewer_agent", "career_master_agent"]);
  assert.deepEqual(events, [
    { kind: "stage_started", stage: "resume_loader" },
    { kind: "stage_completed", stage: "resume_loader" },
    { kind: "stage_started", stage: "resume_parser" },
    { kind: "stage_completed", stage: "resume_parser" },
    { kind: "stage_started", stage: "hr_agent" },
    { kind: "stage_started", stage: "interviewer_agent" },
    { kind: "stage_started", stage: "career_master_agent" },
  ]);

  reviewerRelease.resolve();

  const result = await pipelinePromise;

  assert.equal(result.finalReview.overallScore, 82);
  assert.deepEqual(
    result.reviewerFeedback.map((item) => item.agentName),
    ["hr_agent", "interviewer_agent", "career_master_agent"],
  );

  const firstSummaryEventIndex = events.findIndex((event) => event.stage === "summary_agent");
  const reviewerCompletionIndices = ["hr_agent", "interviewer_agent", "career_master_agent"].map((stage) =>
    events.findIndex((event) => event.kind === "stage_completed" && event.stage === stage),
  );

  assert.ok(reviewerCompletionIndices.every((index) => index > 0));
  assert.ok(reviewerCompletionIndices.every((index) => index < firstSummaryEventIndex));
  assert.deepEqual(events.slice(-5), [
    { kind: "stage_started", stage: "summary_agent" },
    { kind: "stage_completed", stage: "summary_agent" },
    { kind: "stage_started", stage: "rewrite_agent" },
    { kind: "stage_completed", stage: "rewrite_agent" },
    { kind: "pipeline_completed", stage: "review_pipeline" },
  ]);
});

test("runReviewPipeline forwards streaming progress events from agents", async () => {
  const events: ReviewStageEvent[] = [];
  const resumeFile = new File(["Platform engineer"], "resume.txt", {
    type: "text/plain",
  });
  const targetJob: TargetJob = { title: "Platform Engineer", description: "" };

  const document: ResumeDocument = {
    path: "upload://resume.txt",
    fileType: "txt",
    content: "Platform engineer",
  };

  const profile: ResumeProfile = {
    candidateName: "Taylor",
    personalInfo: { name: "Taylor", age: "", phone: "", email: "", location: "", links: [] },
    headline: "Platform Engineer",
    targetRoles: ["Platform Engineer"],
    yearsOfExperience: "4 years",
    coreSkills: ["TypeScript"],
    skillGroups: [],
    workExperiences: [],
    projects: [],
    educationRecords: [],
    strengths: [],
    risks: [],
    missingInformation: [],
    reasoningSummary: [],
  };

  await runReviewPipeline(
    { resumeFile, targetJob },
    (event) => {
      events.push(event);
    },
    {
      loadResume: async () => document,
      runResumeParser: async (_document, onProgress) => {
        onProgress?.({
          phase: "requesting_model",
          message: "已向模型发送结构化请求。",
        });
        onProgress?.({
          phase: "streaming_output",
          message: "结构化字段正在增量生成。",
          snippet: "{\"candidateName\":\"Taylor\"}",
          payload: {
            streamType: "partial_object",
            partialObject: { candidateName: "Taylor" },
          },
        });
        return profile;
      },
      reviewerAgents: [],
      runSummary: async (_document, _profile, _feedback, _targetJob, onProgress) => {
        onProgress?.({
          phase: "validating_output",
          message: "正在校验最终结构化结果。",
        });
        return {
          overallScore: 80,
          readyLevel: "promising",
          executiveSummary: "Solid baseline resume.",
          reasoningSummary: [],
          topPriorities: [],
          scoreBreakdown: [],
          sectionRevisions: [],
        };
      },
      runRewrite: async () => ({
        rewrittenContent: "# Taylor\n\nRewritten resume content.",
        explanation: "Applied final review guidance.",
      }),
    },
  );

  assert.ok(
    events.some(
      (event) =>
        event.kind === "stage_progress" &&
        event.stage === "resume_parser" &&
        event.phase === "requesting_model",
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.kind === "stage_progress" &&
        event.stage === "resume_parser" &&
        event.phase === "streaming_output",
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.kind === "stage_progress" &&
        event.stage === "summary_agent" &&
        event.phase === "validating_output",
    ),
  );
});

test("runReviewPipeline forwards target job context to reviewer and summary agents", async () => {
  const resumeFile = new File(["Agent platform engineer"], "resume.txt", {
    type: "text/plain",
  });
  const targetJob: TargetJob = {
    title: "AI Agent Platform Engineer",
    description: "Build reliable multi-agent workflow infrastructure.",
  };
  const reviewerContexts: TargetJob[] = [];
  let summaryContext: TargetJob | undefined;
  let rewriteContext: TargetJob | undefined;

  const document: ResumeDocument = {
    path: "upload://resume.txt",
    fileType: "txt",
    content: "Agent platform engineer",
  };

  const profile: ResumeProfile = {
    candidateName: "Riley",
    personalInfo: { name: "Riley", age: "", phone: "", email: "", location: "", links: [] },
    headline: "AI Platform Engineer",
    targetRoles: ["AI Platform Engineer"],
    yearsOfExperience: "6 years",
    coreSkills: ["TypeScript", "LLM"],
    skillGroups: [],
    workExperiences: [],
    projects: [],
    educationRecords: [],
    strengths: [],
    risks: [],
    missingInformation: [],
    reasoningSummary: [],
  };

  const reviewerFeedback: ReviewerFeedback = {
    agentName: "hr_agent",
    perspective: "HR",
    overallScore: 84,
    reasoningSummary: ["Compared resume against the target role."],
    strengths: [],
    concerns: [],
    scoreBreakdown: [],
    suggestions: [],
  };

  await runReviewPipeline(
    { resumeFile, targetJob },
    undefined,
    {
      loadResume: async () => document,
      runResumeParser: async () => profile,
      reviewerAgents: [
        {
          name: "hr_agent",
          perspective: "HR",
          run: async (_document, _profile, context) => {
            reviewerContexts.push(context);
            return reviewerFeedback;
          },
        },
      ],
      runSummary: async (_document, _profile, _feedback, context) => {
        summaryContext = context;
        return {
          overallScore: 84,
          readyLevel: "strong",
          executiveSummary: "Target role alignment is clear.",
          reasoningSummary: [],
          topPriorities: [],
          scoreBreakdown: [],
          sectionRevisions: [],
        };
      },
      runRewrite: async (_document, _profile, _feedback, _finalReview, context) => {
        rewriteContext = context;
        return {
          rewrittenContent: "# Riley\n\nRewritten resume content.",
          explanation: "Aligned resume to target role.",
        };
      },
    },
  );

  assert.deepEqual(reviewerContexts, [targetJob]);
  assert.deepEqual(summaryContext, targetJob);
  assert.deepEqual(rewriteContext, targetJob);
});
