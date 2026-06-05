import { tool } from "ai";
import { z } from "zod";

import { extractResumeText } from "@/lib/resume/loader";

export type ReadResumePdfResult = {
  fileName: string;
  charCount: number;
  content: string;
};

export async function readResumePdf(options: {
  fileName: string;
  fileBuffer: Buffer;
  onParsed?: (charCount: number) => void;
}): Promise<ReadResumePdfResult> {
  const text = (await extractResumeText(options.fileName, options.fileBuffer)).trim();
  if (!text) {
    throw new Error(`简历文件内容为空或无法解析：${options.fileName}`);
  }

  options.onParsed?.(text.length);

  return {
    fileName: options.fileName,
    charCount: text.length,
    content: text.length > 12_000 ? `${text.slice(0, 12_000)}\n…（已截断）` : text,
  };
}

export function createReadResumePdfTool(options: {
  fileName: string;
  fileBuffer: Buffer;
  onParsed?: (charCount: number) => void;
}) {
  return tool({
    description:
      "读取并解析用户上传的简历文件（PDF / DOCX / 文本），返回简历纯文本内容。进行任何简历修改前都必须先调用本工具拿到原文。",
    inputSchema: z.object({
      focus: z
        .string()
        .optional()
        .describe("可选：本次需要重点关注或修改的简历部分，例如'项目经历'、'技能'。"),
    }),
    execute: async () => readResumePdf(options),
  });
}
