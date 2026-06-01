import { z } from "zod";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function splitKeywordText(text: string): string[] {
  return text
    .split(/[\r\n]+|(?<!\d)[,;，；、](?!\d)/g)
    .map((part) => part.trim().replace(/^[\s\-•]+|[\s\-•]+$/g, ""))
    .filter(Boolean);
}

function splitTextItems(text: string): string[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/•\s*/g, "\n• ")
    .replace(/●\s*/g, "\n● ")
    .replace(/▪\s*/g, "\n▪ ");

  const parts = normalized
    .split("\n")
    .map((chunk) => chunk.replace(/^\s*(?:[-*•●▪]|\d+[.)、])\s*/u, "").trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : [text.trim()].filter(Boolean);
}

function flattenStrings(value: unknown, options: { splitCommas: boolean }): string[] {
  if (value == null) {
    return [];
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return [];
    }
    return uniqueStrings(options.splitCommas ? splitKeywordText(text) : splitTextItems(text));
  }

  if (typeof value === "number") {
    return [String(value)];
  }

  if (isRecord(value)) {
    const preferredKeys = [
      "items",
      "values",
      "list",
      "roles",
      "skills",
      "strengths",
      "risks",
      "concerns",
      "priorities",
      "bullets",
      "highlights",
      "text",
      "summary",
      "value",
      "title",
      "headline",
    ];

    const collected: string[] = [];
    for (const key of preferredKeys) {
      if (key in value) {
        collected.push(...flattenStrings(value[key], options));
      }
    }
    if (collected.length > 0) {
      return uniqueStrings(collected);
    }

    for (const nested of Object.values(value)) {
      collected.push(...flattenStrings(nested, options));
    }
    return uniqueStrings(collected);
  }

  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((item) => flattenStrings(item, options)));
  }

  return [String(value)];
}

function coerceString(value: unknown, defaultValue = ""): string {
  if (value == null) {
    return defaultValue;
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (isRecord(value)) {
    const preferredKeys = ["text", "summary", "value", "title", "headline", "label", "name", "content"];
    for (const key of preferredKeys) {
      if (key in value) {
        const candidate = coerceString(value[key], "");
        if (candidate) {
          return candidate;
        }
      }
    }
    for (const nested of Object.values(value)) {
      const candidate = coerceString(nested, "");
      if (candidate) {
        return candidate;
      }
    }
    return defaultValue;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = coerceString(item, "");
      if (candidate) {
        return candidate;
      }
    }
    return defaultValue;
  }

  return String(value);
}

function coerceScore(value: unknown): number {
  if (value == null) {
    return 0;
  }

  if (typeof value === "number") {
    return Math.round(value);
  }

  if (isRecord(value)) {
    for (const key of ["overallScore", "overall_score", "score", "rating", "value"]) {
      if (key in value) {
        return coerceScore(value[key]);
      }
    }
  }

  const match = String(value).match(/\d{1,3}/);
  if (match) {
    return Number(match[0]);
  }

  return 0;
}

function normalizePriority(value: unknown): "high" | "medium" | "low" {
  const normalized = coerceString(value, "medium").toLowerCase().replace(/\s+/g, "_");
  const aliases: Record<string, "high" | "medium" | "low"> = {
    urgent: "high",
    critical: "high",
    important: "high",
    major: "high",
    高: "high",
    normal: "medium",
    moderate: "medium",
    中: "medium",
    minor: "low",
    低: "low",
  };

  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }

  return aliases[normalized] ?? "medium";
}

function normalizeReadyLevel(value: unknown): "needs_rewrite" | "promising" | "strong" {
  const normalized = coerceString(value, "promising").toLowerCase().replace(/\s+/g, "_");
  const aliases: Record<string, "needs_rewrite" | "promising" | "strong"> = {
    "needs-rewrite": "needs_rewrite",
    needsrewrite: "needs_rewrite",
    rewrite: "needs_rewrite",
    weak: "needs_rewrite",
    需重写: "needs_rewrite",
    promising: "promising",
    potential: "promising",
    good: "promising",
    有潜力: "promising",
    strong: "strong",
    ready: "strong",
    excellent: "strong",
    很强: "strong",
    优秀: "strong",
  };

  if (normalized === "needs_rewrite" || normalized === "promising" || normalized === "strong") {
    return normalized;
  }

  return aliases[normalized] ?? "promising";
}

function coerceModelList(value: unknown): unknown[] {
  if (value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (isRecord(value)) {
    for (const key of ["items", "values", "list", "records"]) {
      if (key in value && Array.isArray(value[key])) {
        return value[key] as unknown[];
      }
    }
    return [value];
  }
  return [value];
}

function coerceScoreDetailItem(value: unknown): UnknownRecord {
  if (isRecord(value)) {
    const normalized = { ...value };

    if (!("label" in normalized)) {
      for (const alias of ["dimension", "name", "title", "metric"]) {
        if (alias in normalized) {
          normalized.label = normalized[alias];
          break;
        }
      }
    }

    if (!("score" in normalized)) {
      for (const alias of ["rating", "value", "overallScore", "overall_score"]) {
        if (alias in normalized) {
          normalized.score = normalized[alias];
          break;
        }
      }
    }

    if (!("reason" in normalized)) {
      for (const alias of ["comment", "summary", "explanation", "detail"]) {
        if (alias in normalized) {
          normalized.reason = normalized[alias];
          break;
        }
      }
    }

    return normalized;
  }

  if (typeof value === "string") {
    const text = value.trim();
    const exactMatch = text.match(
      /^(?<label>.+?)\s*[:：]\s*(?<score>\d{1,3})(?:\s*\/\s*100|分)?(?:\s*[-—–:：]\s*(?<reason>.+))?$/u,
    );

    if (exactMatch?.groups) {
      return {
        label: exactMatch.groups.label.trim(),
        score: exactMatch.groups.score.trim(),
        reason: exactMatch.groups.reason?.trim() ?? "",
      };
    }

    const scoreMatch = text.match(/\d{1,3}/);
    if (scoreMatch) {
      const label = text.slice(0, scoreMatch.index).trim().replace(/[:：]\s*$/, "") || "Score";
      const reason = text
        .slice((scoreMatch.index ?? 0) + scoreMatch[0].length)
        .trim()
        .replace(/^(?:\/100|分|[-—–:：])\s*/u, "");
      return { label, score: scoreMatch[0], reason };
    }

    return { label: text || "Score", score: 0, reason: "" };
  }

  return { label: coerceString(value, "Score"), score: 0, reason: "" };
}

function coerceScoreBreakdownList(value: unknown): UnknownRecord[] {
  if (value == null) {
    return [];
  }

  let normalized: unknown = value;
  if (isRecord(normalized)) {
    for (const key of ["items", "scores", "breakdown", "dimensions"]) {
      if (key in normalized) {
        normalized = normalized[key];
        break;
      }
    }
  }

  if (typeof normalized === "string") {
    normalized = splitTextItems(normalized);
  }

  const items = Array.isArray(normalized) ? normalized : [normalized];
  return items.map((item) => coerceScoreDetailItem(item));
}

function normalizeResumeProfileSource(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized: UnknownRecord = { ...value };
  const personal = isRecord(normalized.personalInfo)
    ? { ...normalized.personalInfo }
    : isRecord(normalized.personal_info)
      ? { ...normalized.personal_info }
      : isRecord(normalized.contactInfo)
        ? { ...normalized.contactInfo }
        : isRecord(normalized.contact_info)
          ? { ...normalized.contact_info }
          : {};

  for (const [sourceKey, targetKey] of [
    ["name", "name"],
    ["candidateName", "name"],
    ["candidate_name", "name"],
    ["age", "age"],
    ["phone", "phone"],
    ["mobile", "phone"],
    ["email", "email"],
    ["location", "location"],
    ["links", "links"],
    ["urls", "links"],
  ] as const) {
    if (sourceKey in normalized && !(targetKey in personal)) {
      personal[targetKey] = normalized[sourceKey];
    }
  }

  normalized.personalInfo = personal;
  normalized.candidateName = normalized.candidateName ?? normalized.candidate_name;
  normalized.headline =
    normalized.headline ?? normalized.title ?? normalized.professional_headline ?? normalized.role_title;
  normalized.targetRoles = normalized.targetRoles ?? normalized.target_roles;
  normalized.yearsOfExperience =
    normalized.yearsOfExperience ?? normalized.years_of_experience ?? normalized.experience ?? normalized.yoe;
  normalized.coreSkills = normalized.coreSkills ?? normalized.core_skills;
  normalized.skillGroups = normalized.skillGroups ?? normalized.skill_groups ?? normalized.skills_by_category;
  normalized.workExperiences =
    normalized.workExperiences ?? normalized.work_experiences ?? normalized.work_history ?? normalized.experiences;
  normalized.educationRecords =
    normalized.educationRecords ?? normalized.education_records ?? normalized.education ?? normalized.education_history;
  normalized.missingInformation = normalized.missingInformation ?? normalized.missing_information;
  normalized.reasoningSummary = normalized.reasoningSummary ?? normalized.reasoning_summary;

  return normalized;
}

function normalizeReviewerFeedbackSource(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  return {
    ...value,
    agentName: value.agentName ?? value.agent_name ?? "",
    perspective: value.perspective ?? "",
    overallScore: value.overallScore ?? value.overall_score ?? value.score ?? 0,
    reasoningSummary: value.reasoningSummary ?? value.reasoning_summary ?? [],
    scoreBreakdown: value.scoreBreakdown ?? value.score_breakdown ?? [],
  };
}

function normalizeFinalReviewSource(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  return {
    ...value,
    overallScore: value.overallScore ?? value.overall_score ?? 0,
    readyLevel: value.readyLevel ?? value.ready_level ?? "promising",
    executiveSummary: value.executiveSummary ?? value.executive_summary ?? "",
    reasoningSummary: value.reasoningSummary ?? value.reasoning_summary ?? [],
    topPriorities: value.topPriorities ?? value.top_priorities ?? [],
    scoreBreakdown: value.scoreBreakdown ?? value.score_breakdown ?? [],
    sectionRevisions: value.sectionRevisions ?? value.section_revisions ?? [],
  };
}

export const resumeDocumentSchema = z.object({
  path: z.string().min(1),
  fileType: z.string().min(1),
  content: z.string().min(1),
});

export const targetJobSchema = z.object({
  title: z.preprocess((value) => coerceString(value), z.string().min(1)),
  description: z.preprocess((value) => coerceString(value), z.string()).default(""),
});

export const personalInfoSchema = z.object({
  name: z.preprocess((value) => coerceString(value), z.string()).default(""),
  age: z.preprocess((value) => coerceString(value), z.string()).default(""),
  phone: z.preprocess((value) => coerceString(value), z.string()).default(""),
  email: z.preprocess((value) => coerceString(value), z.string()).default(""),
  location: z.preprocess((value) => coerceString(value), z.string()).default(""),
  links: z.preprocess((value) => flattenStrings(value, { splitCommas: true }), z.array(z.string())).default([]),
});

export const resumeSignalHintsSchema = z.object({
  personalInfo: personalInfoSchema.default({
    name: "",
    age: "",
    phone: "",
    email: "",
    location: "",
    links: [],
  }),
});

export const skillGroupSchema = z.object({
  category: z.preprocess((value) => coerceString(value), z.string()),
  items: z.preprocess((value) => flattenStrings(value, { splitCommas: true }), z.array(z.string())).default([]),
});

export const workExperienceSchema = z.object({
  company: z.preprocess((value) => coerceString(value), z.string()).default(""),
  role: z.preprocess((value) => coerceString(value), z.string()).default(""),
  period: z.preprocess((value) => coerceString(value), z.string()).default(""),
  location: z.preprocess((value) => coerceString(value), z.string()).default(""),
  responsibilities: z.preprocess((value) => flattenStrings(value, { splitCommas: false }), z.array(z.string())).default([]),
  achievements: z.preprocess((value) => flattenStrings(value, { splitCommas: false }), z.array(z.string())).default([]),
  technologies: z.preprocess((value) => flattenStrings(value, { splitCommas: true }), z.array(z.string())).default([]),
});

export const projectExperienceSchema = z.object({
  name: z.preprocess((value) => coerceString(value), z.string()).default(""),
  role: z.preprocess((value) => coerceString(value), z.string()).default(""),
  period: z.preprocess((value) => coerceString(value), z.string()).default(""),
  description: z.preprocess((value) => coerceString(value), z.string()).default(""),
  technologies: z.preprocess((value) => flattenStrings(value, { splitCommas: true }), z.array(z.string())).default([]),
  highlights: z.preprocess((value) => flattenStrings(value, { splitCommas: false }), z.array(z.string())).default([]),
});

export const educationRecordSchema = z.object({
  school: z.preprocess((value) => coerceString(value), z.string()).default(""),
  degree: z.preprocess((value) => coerceString(value), z.string()).default(""),
  major: z.preprocess((value) => coerceString(value), z.string()).default(""),
  period: z.preprocess((value) => coerceString(value), z.string()).default(""),
  location: z.preprocess((value) => coerceString(value), z.string()).default(""),
  details: z.preprocess((value) => flattenStrings(value, { splitCommas: false }), z.array(z.string())).default([]),
});

export const scoreDetailSchema = z.object({
  label: z.preprocess((value) => coerceString(value), z.string()),
  score: z.preprocess((value) => coerceScore(value), z.number().int().min(0).max(100)),
  reason: z.preprocess((value) => coerceString(value), z.string()).default(""),
});

const personalInfoResponseFormatSchemaInternal = z.object({
  name: z.string(),
  age: z.string(),
  phone: z.string(),
  email: z.string(),
  location: z.string(),
  links: z.array(z.string()),
});

const skillGroupResponseFormatSchemaInternal = z.object({
  category: z.string(),
  items: z.array(z.string()),
});

const workExperienceResponseFormatSchemaInternal = z.object({
  company: z.string(),
  role: z.string(),
  period: z.string(),
  location: z.string(),
  responsibilities: z.array(z.string()),
  achievements: z.array(z.string()),
  technologies: z.array(z.string()),
});

const projectExperienceResponseFormatSchemaInternal = z.object({
  name: z.string(),
  role: z.string(),
  period: z.string(),
  description: z.string(),
  technologies: z.array(z.string()),
  highlights: z.array(z.string()),
});

const educationRecordResponseFormatSchemaInternal = z.object({
  school: z.string(),
  degree: z.string(),
  major: z.string(),
  period: z.string(),
  location: z.string(),
  details: z.array(z.string()),
});

const scoreDetailResponseFormatSchemaInternal = z.object({
  label: z.string(),
  score: z.number().int().min(0).max(100),
  reason: z.string(),
});

const revisionSuggestionResponseFormatSchemaInternal = z.object({
  section: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  issue: z.string(),
  recommendation: z.string(),
  exampleRewrite: z.string(),
});

export const resumeProfileResponseFormatSchema = z.object({
  candidateName: z.string(),
  personalInfo: personalInfoResponseFormatSchemaInternal,
  headline: z.string(),
  targetRoles: z.array(z.string()),
  yearsOfExperience: z.string(),
  coreSkills: z.array(z.string()),
  skillGroups: z.array(skillGroupResponseFormatSchemaInternal),
  workExperiences: z.array(workExperienceResponseFormatSchemaInternal),
  projects: z.array(projectExperienceResponseFormatSchemaInternal),
  educationRecords: z.array(educationRecordResponseFormatSchemaInternal),
  strengths: z.array(z.string()),
  risks: z.array(z.string()),
  missingInformation: z.array(z.string()),
  reasoningSummary: z.array(z.string()),
});

export const reviewerFeedbackResponseFormatSchema = z.object({
  agentName: z.string(),
  perspective: z.string(),
  overallScore: z.number().int().min(0).max(100),
  reasoningSummary: z.array(z.string()),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  scoreBreakdown: z.array(scoreDetailResponseFormatSchemaInternal),
  suggestions: z.array(revisionSuggestionResponseFormatSchemaInternal),
});

export const finalResumeReviewResponseFormatSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  readyLevel: z.enum(["needs_rewrite", "promising", "strong"]),
  executiveSummary: z.string(),
  reasoningSummary: z.array(z.string()),
  topPriorities: z.array(z.string()),
  scoreBreakdown: z.array(scoreDetailResponseFormatSchemaInternal),
  sectionRevisions: z.array(revisionSuggestionResponseFormatSchemaInternal),
});

const resumeProfileBaseSchema = z.object({
  candidateName: z.preprocess((value) => coerceString(value), z.string()).default(""),
  personalInfo: personalInfoSchema.default({
    name: "",
    age: "",
    phone: "",
    email: "",
    location: "",
    links: [],
  }),
  headline: z.preprocess((value) => coerceString(value), z.string()).default(""),
  targetRoles: z.preprocess((value) => flattenStrings(value, { splitCommas: true }), z.array(z.string())).default([]),
  yearsOfExperience: z.preprocess((value) => coerceString(value), z.string()).default(""),
  coreSkills: z.preprocess((value) => flattenStrings(value, { splitCommas: true }), z.array(z.string())).default([]),
  skillGroups: z.preprocess((value) => coerceModelList(value), z.array(skillGroupSchema)).default([]),
  workExperiences: z.preprocess((value) => coerceModelList(value), z.array(workExperienceSchema)).default([]),
  projects: z.preprocess((value) => coerceModelList(value), z.array(projectExperienceSchema)).default([]),
  educationRecords: z.preprocess((value) => coerceModelList(value), z.array(educationRecordSchema)).default([]),
  strengths: z.preprocess((value) => flattenStrings(value, { splitCommas: false }), z.array(z.string())).default([]),
  risks: z.preprocess((value) => flattenStrings(value, { splitCommas: false }), z.array(z.string())).default([]),
  missingInformation: z.preprocess((value) => flattenStrings(value, { splitCommas: false }), z.array(z.string())).default([]),
  reasoningSummary: z.preprocess((value) => flattenStrings(value, { splitCommas: false }), z.array(z.string())).default([]),
});

export const resumeProfileSchema = z
  .preprocess(normalizeResumeProfileSource, resumeProfileBaseSchema)
  .transform((profile) => {
    const candidateName = profile.candidateName || profile.personalInfo.name;
    const personalInfo = {
      ...profile.personalInfo,
      name: profile.personalInfo.name || candidateName,
    };
    const coreSkills =
      profile.coreSkills.length > 0
        ? uniqueStrings(profile.coreSkills)
        : uniqueStrings(profile.skillGroups.flatMap((group) => group.items));

    return {
      ...profile,
      candidateName,
      personalInfo,
      coreSkills,
    };
  });

export const revisionSuggestionSchema = z.object({
  section: z.preprocess((value) => coerceString(value), z.string()),
  priority: z.preprocess((value) => normalizePriority(value), z.enum(["high", "medium", "low"])),
  issue: z.preprocess((value) => coerceString(value), z.string()),
  recommendation: z.preprocess((value) => coerceString(value), z.string()),
  exampleRewrite: z.preprocess((value) => coerceString(value), z.string()).default(""),
});

export const reviewerFeedbackSchema = z.preprocess(
  normalizeReviewerFeedbackSource,
  z.object({
    agentName: z.preprocess((value) => coerceString(value), z.string()).default(""),
    perspective: z.preprocess((value) => coerceString(value), z.string()).default(""),
    overallScore: z.preprocess((value) => coerceScore(value), z.number().int().min(0).max(100)).default(0),
    reasoningSummary: z.preprocess((value) => flattenStrings(value, { splitCommas: false }), z.array(z.string())).default([]),
    strengths: z.preprocess((value) => flattenStrings(value, { splitCommas: false }), z.array(z.string())).default([]),
    concerns: z.preprocess((value) => flattenStrings(value, { splitCommas: false }), z.array(z.string())).default([]),
    scoreBreakdown: z.preprocess((value) => coerceScoreBreakdownList(value), z.array(scoreDetailSchema)).default([]),
    suggestions: z.preprocess((value) => coerceModelList(value), z.array(revisionSuggestionSchema)).default([]),
  }),
);

export const finalResumeReviewSchema = z.preprocess(
  normalizeFinalReviewSource,
  z.object({
    overallScore: z.preprocess((value) => coerceScore(value), z.number().int().min(0).max(100)).default(0),
    readyLevel: z.preprocess((value) => normalizeReadyLevel(value), z.enum(["needs_rewrite", "promising", "strong"])).default("promising"),
    executiveSummary: z.preprocess((value) => coerceString(value), z.string()).default(""),
    reasoningSummary: z.preprocess((value) => flattenStrings(value, { splitCommas: false }), z.array(z.string())).default([]),
    topPriorities: z.preprocess((value) => flattenStrings(value, { splitCommas: false }), z.array(z.string())).default([]),
    scoreBreakdown: z.preprocess((value) => coerceScoreBreakdownList(value), z.array(scoreDetailSchema)).default([]),
    sectionRevisions: z.preprocess((value) => coerceModelList(value), z.array(revisionSuggestionSchema)).default([]),
  }),
);

export const resumeRewriteResponseFormatSchema = z.object({
  rewrittenContent: z.string(),
  explanation: z.string(),
});

export const resumeRewriteSchema = z.object({
  rewrittenContent: z.preprocess((value) => coerceString(value), z.string()).default(""),
  explanation: z.preprocess((value) => coerceString(value), z.string()).default(""),
});

export type ResumeRewrite = z.infer<typeof resumeRewriteSchema>;

export const reviewRunResultSchema = z.object({
  document: resumeDocumentSchema,
  targetJob: targetJobSchema.optional(),
  profile: resumeProfileSchema,
  reviewerFeedback: z.array(reviewerFeedbackSchema).default([]),
  finalReview: finalResumeReviewSchema,
  rewrite: resumeRewriteSchema.optional(),
});


export const reviewStageProgressPhaseSchema = z.enum([
  "requesting_model",
  "model_thinking",
  "streaming_output",
  "validating_output",
]);

export const reviewStageEventSchema = z.object({
  kind: z.enum(["stage_started", "stage_progress", "stage_completed", "pipeline_completed"]),
  stage: z.string(),
  phase: reviewStageProgressPhaseSchema.nullable().optional().default(null),
  title: z.string(),
  message: z.string(),
  details: z.array(z.string()).default([]),
  snippet: z.preprocess((value) => coerceString(value), z.string()).optional().default(""),
  payload: z.unknown().nullable().optional().default(null),
});

export const reviewStreamChunkSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("event"),
    event: reviewStageEventSchema,
  }),
  z.object({
    type: z.literal("result"),
    result: reviewRunResultSchema,
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
]);

export type ResumeDocument = z.infer<typeof resumeDocumentSchema>;
export type TargetJob = z.infer<typeof targetJobSchema>;
export type PersonalInfo = z.infer<typeof personalInfoSchema>;
export type ResumeSignalHints = z.infer<typeof resumeSignalHintsSchema>;
export type SkillGroup = z.infer<typeof skillGroupSchema>;
export type WorkExperience = z.infer<typeof workExperienceSchema>;
export type ProjectExperience = z.infer<typeof projectExperienceSchema>;
export type EducationRecord = z.infer<typeof educationRecordSchema>;
export type ScoreDetail = z.infer<typeof scoreDetailSchema>;
export type ResumeProfile = z.infer<typeof resumeProfileSchema>;
export type RevisionSuggestion = z.infer<typeof revisionSuggestionSchema>;
export type ReviewerFeedback = z.infer<typeof reviewerFeedbackSchema>;
export type FinalResumeReview = z.infer<typeof finalResumeReviewSchema>;
export type ReviewRunResult = z.infer<typeof reviewRunResultSchema>;
export type ReviewStageProgressPhase = z.infer<typeof reviewStageProgressPhaseSchema>;
export type ReviewStageEvent = z.infer<typeof reviewStageEventSchema>;
export type ReviewStreamChunk = z.infer<typeof reviewStreamChunkSchema>;
