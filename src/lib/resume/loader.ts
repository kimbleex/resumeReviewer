import mammoth from "mammoth";
import pdfParse from "pdf-parse";

import { resumeDocumentSchema, type ResumeDocument, type TargetJob } from "@/lib/review/schemas";

export class UnsupportedResumeFormatError extends Error {}

export type ResumeSource = {
  resumeFile: File;
  targetJob: TargetJob;
};

const SUPPORTED_SUFFIXES = new Set([".txt", ".md", ".pdf", ".docx"]);

function resolveSuffix(fileName: string): string {
  const match = fileName.match(/(\.[^.]+)$/);
  return match?.[1]?.toLowerCase() ?? "";
}

export async function extractResumeText(fileName: string, buffer: Buffer): Promise<string> {
  return readBufferContent(fileName, buffer);
}

async function readBufferContent(fileName: string, buffer: Buffer): Promise<string> {
  const suffix = resolveSuffix(fileName);

  if (!SUPPORTED_SUFFIXES.has(suffix)) {
    throw new UnsupportedResumeFormatError(`Unsupported resume format: ${suffix || "unknown"}`);
  }

  if (suffix === ".txt" || suffix === ".md") {
    return buffer.toString("utf8");
  }

  if (suffix === ".pdf") {
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }

  if (suffix === ".docx") {
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value;
  }

  throw new UnsupportedResumeFormatError(`Unsupported resume format: ${suffix || "unknown"}`);
}

export async function loadResumeSource(source: ResumeSource): Promise<ResumeDocument> {
  const fileName = source.resumeFile.name || "uploaded-resume.txt";
  const arrayBuffer = await source.resumeFile.arrayBuffer();
  const content = (await readBufferContent(fileName, Buffer.from(arrayBuffer))).trim();

  if (!content) {
    throw new Error(`Resume file is empty or unreadable: ${fileName}`);
  }

  return resumeDocumentSchema.parse({
    path: `upload://${fileName}`,
    fileType: resolveSuffix(fileName).replace(".", ""),
    content,
  });
}
