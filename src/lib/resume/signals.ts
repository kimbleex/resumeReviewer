import { resumeSignalHintsSchema, type ResumeSignalHints } from "@/lib/review/schemas";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_PATTERN = /(?:\+?\d[\d\s-]{7,}\d)/;
const URL_PATTERN = /https?:\/\/[^\s)]+/gi;

function firstMatch(patterns: RegExp[], content: string): string {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

function inferName(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);

  for (const line of lines) {
    if (line.length > 40) continue;
    if (/[:：@]|https?:\/\//i.test(line)) continue;
    if (/\d/.test(line)) continue;
    if (line.split(/\s+/).length > 5) continue;
    return line;
  }

  return "";
}

export function extractResumeSignals(content: string): ResumeSignalHints {
  const email = content.match(EMAIL_PATTERN)?.[0] ?? "";
  const phone = content.match(PHONE_PATTERN)?.[0]?.trim() ?? "";
  const links = Array.from(new Set(content.match(URL_PATTERN) ?? []));

  const age = firstMatch(
    [/年龄\s*[:：]?\s*(\d{1,2})/u, /\bage\s*[:：]?\s*(\d{1,2})/iu],
    content,
  );

  const location = firstMatch(
    [/所在地\s*[:：]?\s*([^\n]+)/u, /Location\s*[:：]?\s*([^\n]+)/iu, /居住地\s*[:：]?\s*([^\n]+)/u],
    content,
  );

  return resumeSignalHintsSchema.parse({
    personalInfo: {
      name: inferName(content),
      age,
      phone,
      email,
      location,
      links,
    },
  });
}
