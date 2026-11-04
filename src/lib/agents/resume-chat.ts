import { streamText } from "ai";

import { getStructuredAgentTimeout, structuredAgentErrorMessage } from "@/lib/agents/base";
import { createLanguageModel } from "@/lib/llm/model";
import { extractResumeText } from "@/lib/resume/loader";
import type { ChatMessage } from "@/lib/agents/chat-context";

export type ParsedResumeMemory = {
  fileName: string;
  charCount: number;
  content: string;
};

export type ResumeAgentEvent =
  | {
      type: "step";
      id: string;
      tag: "agent" | "model";
      title: string;
      detail?: string;
      status: "running" | "done" | "failed";
    }
  | { type: "answer-delta"; text: string }
  | { type: "resume-cache"; parsedResume: ParsedResumeMemory }
  | { type: "done"; citation: string }
  | { type: "error"; message: string };

const RESUME_EDIT_SYSTEM_PROMPT = `你是 RA（Resume Assistant），一位友好、务实的对话助手，擅长简历优化、求职、面试准备和职业发展。
以用户当前的问题为准，结合此前对话理解“继续”“刚才那版”等指代，并沿用用户已经补充的事实和偏好。
简历和求职是你的主要帮助方向，也可以自然回答其他问题，无需因为偏离简历主题而拒绝。
如果提供了简历原文，将其作为参考资料；区分原文事实、用户补充的信息与你的建议，不编造候选人的经历、公司或数字。
没有简历时也可以正常交流，需要具体资料时再询问。
按问题需要选择合适的篇幅和格式，可使用 Markdown；修改文本时优先给出可直接使用的内容，必要时简要说明理由。`;

async function readResumePdf(options: {
  fileName: string;
  fileBuffer: Buffer;
  onParsed?: (charCount: number) => void;
}): Promise<ParsedResumeMemory> {
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

const READING_STEP_ID = "reading";
const GENERATING_STEP_ID = "generating";

/**
 * 运行"改简历" Agent：先解析简历（或复用前端缓存的解析结果），再根据用户问题流式产出回答。
 * 所有过程通过 onEvent 以离散事件上报，由前端渲染步骤卡片与最终回答。
 */
export async function runResumeEditAgent(options: {
  fileName: string;
  fileBuffer: Buffer;
  prompt: string;
  parsedResume?: ParsedResumeMemory;
  history?: ChatMessage[];
  onEvent: (event: ResumeAgentEvent) => void;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { fileName, fileBuffer, prompt, parsedResume, history = [], onEvent, abortSignal } = options;

  let parsedChars = 0;
  let answerStarted = false;
  let readingDone = false;
  let pdfReadStarted = false;
  let pdfReadDone = false;

  const showReadingRunning = () => {
    onEvent({
      type: "step",
      id: READING_STEP_ID,
      tag: "agent",
      title: "模型提取用户问题",
      status: "running",
    });
  };

  const markReadingDone = () => {
    if (readingDone) {
      return;
    }
    readingDone = true;
    onEvent({
      type: "step",
      id: READING_STEP_ID,
      tag: "agent",
      title: "模型提取用户问题",
      status: "done",
    });
  };

  showReadingRunning();

  try {
    markReadingDone();
    const resume = parsedResume?.content
      ? parsedResume
      : fileBuffer.length > 0 ? await (async () => {
          pdfReadStarted = true;
          onEvent({
            type: "step",
            id: "tool-read-resume-pdf",
            tag: "model",
            title: "调用 read_resume_pdf 工具",
            status: "running",
          });

          const parsed = await readResumePdf({
            fileName,
            fileBuffer,
            onParsed: (charCount) => {
              parsedChars = charCount;
            },
          });
          pdfReadDone = true;

          onEvent({
            type: "step",
            id: "tool-read-resume-pdf",
            tag: "model",
            title: "调用 read_resume_pdf 工具",
            detail: `已解析简历，提取 ${parsed.charCount} 字`,
            status: "done",
          });
          onEvent({ type: "resume-cache", parsedResume: parsed });
          return parsed;
        })() : undefined;

    if (parsedResume?.content) {
      parsedChars = parsedResume.charCount || parsedResume.content.length;
      onEvent({
        type: "step",
        id: "tool-read-resume-pdf-cache",
        tag: "model",
        title: "复用 read_resume_pdf 解析结果",
        detail: `已复用 ${parsedChars} 字简历原文`,
        status: "done",
      });
    }

    const result = streamText({
      model: createLanguageModel(),
      system: RESUME_EDIT_SYSTEM_PROMPT,
      messages: [
        ...(resume ? [{ role: "user" as const, content: `【简历参考资料】\n文件：${resume.fileName}\n${resume.content}` }] : []),
        ...history,
        { role: "user", content: prompt.trim() },
      ],
      abortSignal,
      timeout: getStructuredAgentTimeout(),
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta": {
          if (!answerStarted) {
            markReadingDone();
            answerStarted = true;
            // 生成中：先展示转圈动画，流结束后再标记完成。
            onEvent({
              type: "step",
              id: GENERATING_STEP_ID,
              tag: "model",
              title: "模型汇总最终输出",
              status: "running",
            });
          }
          onEvent({ type: "answer-delta", text: part.text });
          break;
        }
        case "error": {
          throw part.error;
        }
        default:
          break;
      }
    }

    // 流结束：把仍在运行的步骤标记为完成。
    markReadingDone();
    if (answerStarted) {
      onEvent({
        type: "step",
        id: GENERATING_STEP_ID,
        tag: "model",
        title: "模型汇总最终输出",
        status: "done",
      });
    }

    const citation = parsedChars > 0 ? `已读取并解析简历：${fileName} · 提取 ${parsedChars} 字` : "";
    onEvent({ type: "done", citation });
  } catch (error) {
    // 把当前正在运行的步骤标记为失败，避免一直转圈。
    if (answerStarted) {
      onEvent({
        type: "step",
        id: GENERATING_STEP_ID,
        tag: "model",
        title: "模型汇总最终输出",
        status: "failed",
      });
    } else if (!readingDone) {
      onEvent({
        type: "step",
        id: READING_STEP_ID,
        tag: "agent",
        title: "模型提取用户问题",
        status: "failed",
      });
    } else if (pdfReadStarted && !pdfReadDone) {
      onEvent({
        type: "step",
        id: "tool-read-resume-pdf",
        tag: "model",
        title: "调用 read_resume_pdf 工具失败",
        detail: structuredAgentErrorMessage(error),
        status: "failed",
      });
    }
    onEvent({ type: "error", message: structuredAgentErrorMessage(error) });
  }
}
