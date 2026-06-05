import { streamText } from "ai";

import { getStructuredAgentTimeout, structuredAgentErrorMessage } from "@/lib/agents/base";
import { createLanguageModel } from "@/lib/llm";
import type { ParsedResumeMemory, ResumeAgentEvent } from "./events";
import { RESUME_EDIT_SYSTEM_PROMPT } from "./prompts";
import { readResumePdf } from "./tools/read-resume-pdf";

export type { ResumeAgentEvent } from "./events";

const READING_STEP_ID = "reading";
const GENERATING_STEP_ID = "generating";

/**
 * 运行"改简历" Agent：让模型自行决定调用 read_resume_pdf 工具解析简历，
 * 再根据用户问题流式产出修改结果。所有过程通过 onEvent 以离散事件上报，
 * 由前端动态渲染步骤卡片与最终回答（不再使用写死的步骤）。
 */
export async function runResumeEditAgent(options: {
  fileName: string;
  fileBuffer: Buffer;
  prompt: string;
  parsedResume?: ParsedResumeMemory;
  onEvent: (event: ResumeAgentEvent) => void;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { fileName, fileBuffer, prompt, parsedResume, onEvent, abortSignal } = options;

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
      : await (async () => {
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
        })();

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
      prompt: [
        `【用户问题】\n${prompt.trim()}`,
        `【简历文件】\n${resume.fileName}`,
        `【简历原文】\n${resume.content}`,
      ].join("\n\n"),
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
