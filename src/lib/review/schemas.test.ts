import assert from "node:assert/strict";
import test from "node:test";

import { finalResumeReviewSchema, resumeProfileSchema, reviewerFeedbackSchema } from "./schemas";

test("resumeProfileSchema coerces nested LLM output into stable resume sections", () => {
  const profile = resumeProfileSchema.parse({
    personal_info: {
      name: "Ada Lovelace",
      age: "28",
      phone: "+86 13800000000",
      email: "ada@example.com",
      location: "Shanghai",
      links: ["https://github.com/ada"],
    },
    title: "AI Backend Engineer",
    target_roles: { primary: ["AI Engineer"], secondary: ["Platform Engineer"] },
    skill_groups: [
      { category: "Programming", items: ["Python", "SQL"] },
      { category: "Frameworks", items: ["LangChain"] },
    ],
    work_experiences: [
      {
        company: "OpenAI",
        role: "Backend Engineer",
        period: "2023-2025",
        responsibilities: ["Built agent orchestration services."],
        achievements: ["Reduced review latency by 30%."],
      },
    ],
    projects: [
      {
        name: "Resume Reviewer",
        role: "Backend Lead",
        period: "2025",
        technologies: ["Python", "LangChain"],
        highlights: ["Built a multi-agent resume evaluation workflow."],
      },
    ],
    education_records: [
      {
        school: "MIT",
        degree: "BS",
        major: "Computer Science",
        period: "2018-2022",
      },
    ],
    strengths: [{ text: "Strong backend ownership" }],
    risks: [{ summary: "Needs more quantified impact" }],
  });

  assert.equal(profile.candidateName, "Ada Lovelace");
  assert.equal(profile.personalInfo.phone, "+86 13800000000");
  assert.equal(profile.headline, "AI Backend Engineer");
  assert.deepEqual(profile.targetRoles, ["AI Engineer", "Platform Engineer"]);
  assert.deepEqual(profile.coreSkills, ["Python", "SQL", "LangChain"]);
  assert.equal(profile.projects[0]?.name, "Resume Reviewer");
});

test("reviewerFeedbackSchema accepts string score breakdown items", () => {
  const feedback = reviewerFeedbackSchema.parse({
    overall_score: "82/100",
    strengths: [{ text: "Readable structure" }],
    concerns: [{ text: "Needs quantified outcomes" }],
    score_breakdown: [
      "ATS Match: 82/100 - keyword fit is good",
      "Clarity：76分 - bullets are readable but metrics are thin",
    ],
  });

  assert.equal(feedback.overallScore, 82);
  assert.deepEqual(feedback.scoreBreakdown[0], {
    label: "ATS Match",
    score: 82,
    reason: "keyword fit is good",
  });
  assert.equal(feedback.scoreBreakdown[1]?.label, "Clarity");
  assert.equal(feedback.scoreBreakdown[1]?.score, 76);
});

test("finalResumeReviewSchema normalizes ready level aliases", () => {
  const review = finalResumeReviewSchema.parse({
    overall_score: "88",
    ready_level: "有潜力",
    executive_summary: { text: "Strong technical foundation." },
    top_priorities: { items: ["Quantify project impact."] },
    section_revisions: [],
  });

  assert.equal(review.readyLevel, "promising");
  assert.deepEqual(review.topPriorities, ["Quantify project impact."]);
});
