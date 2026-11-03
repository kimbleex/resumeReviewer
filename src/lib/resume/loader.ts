import mammoth from "mammoth";
import pdfParse from "pdf-parse";

import { resumeDocumentSchema, type ResumeDocument, type TargetJob } from "@/lib/review/schemas";

export type ResumeSource = {
  resumeFile: File;
  targetJob: TargetJob;
};

function resolveSuffix(fileName: string): string {
  const match = fileName.match(/(\.[^.]+)$/);
  return match?.[1]?.toLowerCase() ?? "";
}

export async function extractResumeText(fileName: string, buffer: Buffer): Promise<string> {
  switch (resolveSuffix(fileName)) {
    case ".txt":
    case ".md":
      return buffer.toString("utf8");
    case ".pdf":
      return (await pdfParse(buffer)).text;
    case ".docx":
      return (await mammoth.extractRawText({ buffer })).value;
    default:
      throw new Error(`Unsupported resume format: ${resolveSuffix(fileName) || "unknown"}`);
  }
}

export async function loadResumeSource(source: ResumeSource): Promise<ResumeDocument> {
  const fileName = source.resumeFile.name || "uploaded-resume.txt";
  const arrayBuffer = await source.resumeFile.arrayBuffer();
  const content = (await extractResumeText(fileName, Buffer.from(arrayBuffer))).trim();

  if (!content) {
    throw new Error(`Resume file is empty or unreadable: ${fileName}`);
  }

  return resumeDocumentSchema.parse({
    path: `upload://${fileName}`,
    fileType: resolveSuffix(fileName).replace(".", ""),
    content,
  });
}
