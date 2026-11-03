import assert from "node:assert/strict";
import test from "node:test";

import { runReviewPipeline } from "@/lib/review/pipeline";
import type { ResumeDocument, ResumeProfile, ReviewStageEvent, ReviewerFeedback, TargetJob } from "@/lib/review/schemas";

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
      runSummary: async (_feedback, _targetJob, onProgress) => {
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
  assert.ok(
    events
      .filter((event) => event.kind === "stage_progress")
      .every((event) => event.snippet === "" && event.payload === null),
    "stage progress events should not expose raw LLM output to the frontend",
  );
});

test("runReviewPipeline forwards abort signal to each agent executor", async () => {
  const resumeFile = new File(["Platform engineer"], "resume.txt", {
    type: "text/plain",
  });
  const targetJob: TargetJob = { title: "Platform Engineer", description: "" };
  const abortController = new AbortController();
  let parserSignal: AbortSignal | undefined;
  let reviewerSignal: AbortSignal | undefined;
  let summarySignal: AbortSignal | undefined;
  let rewriteSignal: AbortSignal | undefined;

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
  const feedback: ReviewerFeedback = {
    agentName: "hr_agent",
    perspective: "HR",
    overallScore: 82,
    reasoningSummary: [],
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
      runResumeParser: async (_document, _onProgress, abortSignal) => {
        parserSignal = abortSignal;
        return profile;
      },
      reviewerAgents: [
        {
          name: "hr_agent",
          perspective: "HR",
          run: async (_profile, _targetJob, _onProgress, abortSignal) => {
            reviewerSignal = abortSignal;
            return feedback;
          },
        },
      ],
      runSummary: async (_feedback, _targetJob, _onProgress, abortSignal) => {
        summarySignal = abortSignal;
        return {
          overallScore: 82,
          readyLevel: "promising",
          executiveSummary: "Solid baseline resume.",
          reasoningSummary: [],
          topPriorities: [],
          scoreBreakdown: [],
          sectionRevisions: [],
        };
      },
      runRewrite: async (_document, _finalReview, _targetJob, _onProgress, abortSignal) => {
        rewriteSignal = abortSignal;
        return {
          rewrittenContent: "# Taylor\n\nRewritten resume content.",
          explanation: "Applied final review guidance.",
        };
      },
    },
    { abortSignal: abortController.signal },
  );

  assert.equal(parserSignal, abortController.signal);
  assert.equal(reviewerSignal, abortController.signal);
  assert.equal(summarySignal, abortController.signal);
  assert.equal(rewriteSignal, abortController.signal);
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
          run: async (_profile, context) => {
            reviewerContexts.push(context);
            return reviewerFeedback;
          },
        },
      ],
      runSummary: async (_feedback, context) => {
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
      runRewrite: async (_document, _finalReview, context) => {
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

test("runReviewPipeline resumes from completed stage payloads and only reruns missing reviewers onward", async () => {
  const events: Array<{ kind: string; stage: string; message: string }> = [];
  const resumeFile = new File(["Ignored because document is cached"], "resume.txt", {
    type: "text/plain",
  });
  const targetJob: TargetJob = { title: "RPA Engineer", description: "" };
  const document: ResumeDocument = {
    path: "upload://cached.txt",
    fileType: "txt",
    content: "Cached resume text",
  };
  const profile: ResumeProfile = {
    candidateName: "Casey",
    personalInfo: { name: "Casey", age: "", phone: "", email: "", location: "", links: [] },
    headline: "RPA Engineer",
    targetRoles: ["RPA Engineer"],
    yearsOfExperience: "3 years",
    coreSkills: ["RPA"],
    skillGroups: [],
    workExperiences: [],
    projects: [],
    educationRecords: [],
    strengths: [],
    risks: [],
    missingInformation: [],
    reasoningSummary: ["Cached parser result."],
  };
  const cachedHrFeedback: ReviewerFeedback = {
    agentName: "hr_agent",
    perspective: "HR",
    overallScore: 70,
    reasoningSummary: ["Cached HR result."],
    strengths: [],
    concerns: [],
    scoreBreakdown: [],
    suggestions: [],
  };
  const freshInterviewerFeedback: ReviewerFeedback = {
    agentName: "interviewer_agent",
    perspective: "Interviewer",
    overallScore: 76,
    reasoningSummary: ["Fresh interviewer result."],
    strengths: [],
    concerns: [],
    scoreBreakdown: [],
    suggestions: [],
  };
  const freshCareerFeedback: ReviewerFeedback = {
    agentName: "career_master_agent",
    perspective: "Career Master",
    overallScore: 78,
    reasoningSummary: ["Fresh career result."],
    strengths: [],
    concerns: [],
    scoreBreakdown: [],
    suggestions: [],
  };
  let summaryFeedbackNames: string[] = [];

  const result = await runReviewPipeline(
    { resumeFile, targetJob },
    (event) => {
      events.push({ kind: event.kind, stage: event.stage, message: event.message });
    },
    {
      loadResume: async () => {
        throw new Error("loader should be skipped");
      },
      runResumeParser: async () => {
        throw new Error("parser should be skipped");
      },
      reviewerAgents: [
        {
          name: "hr_agent",
          perspective: "HR",
          run: async () => {
            throw new Error("cached HR reviewer should be skipped");
          },
        },
        { name: "interviewer_agent", perspective: "Interviewer", run: async () => freshInterviewerFeedback },
        { name: "career_master_agent", perspective: "Career Master", run: async () => freshCareerFeedback },
      ],
      runSummary: async (feedback) => {
        summaryFeedbackNames = feedback.map((item) => item.agentName);
        return {
          overallScore: 80,
          readyLevel: "promising",
          executiveSummary: "Resumed run completed.",
          reasoningSummary: [],
          topPriorities: [],
          scoreBreakdown: [],
          sectionRevisions: [],
        };
      },
      runRewrite: async () => ({
        rewrittenContent: "# Casey\n\nRewritten resume content.",
        explanation: "Applied resumed review guidance.",
      }),
    },
    {
      resumeState: {
        document,
        profile,
        reviewerFeedback: {
          hr_agent: cachedHrFeedback,
        },
      },
    },
  );

  assert.deepEqual(summaryFeedbackNames, ["hr_agent", "interviewer_agent", "career_master_agent"]);
  assert.deepEqual(result.reviewerFeedback.map((item) => item.agentName), summaryFeedbackNames);
  assert.ok(
    events.some((event) => event.kind === "stage_completed" && event.stage === "resume_loader" && /复用/.test(event.message)),
  );
  assert.ok(
    events.some((event) => event.kind === "stage_completed" && event.stage === "resume_parser" && /复用/.test(event.message)),
  );
  assert.ok(events.some((event) => event.kind === "stage_completed" && event.stage === "hr_agent" && /复用/.test(event.message)));
  assert.ok(events.some((event) => event.kind === "stage_started" && event.stage === "interviewer_agent"));
  assert.ok(events.some((event) => event.kind === "stage_started" && event.stage === "career_master_agent"));
});
