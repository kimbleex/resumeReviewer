import { test } from "node:test";
import assert from "node:assert/strict";

import { buildReviewResumeState, interruptRunningStages } from "@/lib/review/local-run-cache";
import type { ResumeDocument, ResumeProfile, ReviewerFeedback } from "@/lib/review/schemas";
import { createInitialStageStatus } from "@/lib/review/stages";

test("buildReviewResumeState maps completed stage payloads to API resume state", () => {
  const document: ResumeDocument = {
    path: "upload://resume.txt",
    fileType: "txt",
    content: "Resume text",
  };
  const profile: ResumeProfile = {
    candidateName: "Jordan",
    personalInfo: { name: "Jordan", age: "", phone: "", email: "", location: "", links: [] },
    headline: "RPA Engineer",
    targetRoles: ["RPA Engineer"],
    yearsOfExperience: "4 years",
    coreSkills: ["RPA"],
    skillGroups: [],
    workExperiences: [],
    projects: [],
    educationRecords: [],
    strengths: [],
    risks: [],
    missingInformation: [],
    reasoningSummary: [],
  };
  const hrFeedback: ReviewerFeedback = {
    agentName: "hr_agent",
    perspective: "HR",
    overallScore: 72,
    reasoningSummary: [],
    strengths: [],
    concerns: [],
    scoreBreakdown: [],
    suggestions: [],
  };

  const resumeState = buildReviewResumeState({
    stagePayloads: {
      resume_loader: document,
      resume_parser: profile,
      hr_agent: hrFeedback,
    },
    finalResult: null,
  });

  assert.deepEqual(resumeState, {
    document,
    profile,
    reviewerFeedback: {
      hr_agent: hrFeedback,
    },
  });
});

test("interruptRunningStages preserves completed nodes and marks active nodes as interrupted", () => {
  assert.deepEqual(
    interruptRunningStages({
      ...createInitialStageStatus(),
      resume_loader: "done",
      resume_parser: "done",
      hr_agent: "running",
      interviewer_agent: "running",
    }),
    {
      ...createInitialStageStatus(),
      resume_loader: "done",
      resume_parser: "done",
      hr_agent: "interrupted",
      interviewer_agent: "interrupted",
    },
  );
});
