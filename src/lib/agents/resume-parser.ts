import { invokeStructuredAgent, dumpJson, type StructuredAgentProgress } from "@/lib/agents/base";
import { buildResumeParserPrompt } from "@/lib/agents/prompts";
import { extractResumeSignals } from "@/lib/resume/signals";
import {
  resumeProfileResponseFormatSchema,
  resumeProfileSchema,
  type ResumeDocument,
  type ResumeProfile,
  type ResumeSignalHints,
} from "@/lib/review/schemas";

function mergeHints(profile: ResumeProfile, hints: ResumeSignalHints): ResumeProfile {
  return resumeProfileSchema.parse({
    ...profile,
    candidateName: profile.candidateName || hints.personalInfo.name,
    personalInfo: {
      name: profile.personalInfo.name || hints.personalInfo.name,
      age: profile.personalInfo.age || hints.personalInfo.age,
      phone: profile.personalInfo.phone || hints.personalInfo.phone,
      email: profile.personalInfo.email || hints.personalInfo.email,
      location: profile.personalInfo.location || hints.personalInfo.location,
      links: Array.from(new Set([...profile.personalInfo.links, ...hints.personalInfo.links])),
    },
  });
}

export async function runResumeParser(
  document: ResumeDocument,
  onProgress?: (event: StructuredAgentProgress) => void,
  abortSignal?: AbortSignal,
): Promise<ResumeProfile> {
  const hints = extractResumeSignals(document.content);

  const profile = await invokeStructuredAgent({
    name: "resume_parser",
    systemPrompt: buildResumeParserPrompt(),
    responseFormat: resumeProfileResponseFormatSchema,
    normalize: (value) => resumeProfileSchema.parse(value),
    onProgress,
    abortSignal,
    userContent: `
请解析这份简历，并输出完整的结构化简历画像。
简历来源：${document.path}
文件类型：${document.fileType}

规则提取信号（仅作参考，需和正文交叉验证）：
${dumpJson(hints)}

简历全文：
${document.content}
    `.trim(),
  });

  return mergeHints(profile, hints);
}
