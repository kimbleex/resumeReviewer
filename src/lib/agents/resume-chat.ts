import { streamText } from "ai";

import { getStructuredAgentTimeout, structuredAgentErrorMessage } from "@/lib/agents/base";
import { createLanguageModel } from "@/lib/llm/model";
import { extractResumeText } from "@/lib/resume/loader";

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

/**
 * 当用户的问题与"修改简历"无关时，Agent 必须原样返回这句话。
 */
const RESUME_EDIT_REFUSAL = "我无法完成非修改简历相关的内容";

const RESUME_EDIT_SYSTEM_PROMPT = `你是一名专业的简历助手（Resume Assistant，简称 RA）。你的职责是基于用户上传的简历原文，回答简历内容问题，并帮助用户修改、优化、润色、重写简历。

# 工作流程
1. 系统已经在用户消息中提供【简历原文】和【用户问题】，你不需要也不能再调用工具。
2. 先判断用户问题是否与这份简历的读取、理解、修改、新增、删除、优化有关。
3. 如果用户只是询问简历里的事实信息，必须基于【简历原文】直接回答。
4. 如果用户要求修改、优化、润色或重写，结合原文给出有针对性的修改结果与简要说明。

# 严格的相关性约束（最重要）
- 只要用户的问题与"简历"无关（例如闲聊、写代码、查天气、数学题、通用问答、与简历内容无关的请求等），你必须直接、逐字输出下面这句话，并且不要输出任何其他内容：
${RESUME_EDIT_REFUSAL}

# 输出要求（仅当与简历相关时）
- 使用 Markdown 输出，结构清晰。
- 内容问答要简洁准确，不要编造原文没有的信息。
- 修改类请求要给出"修改后的内容"，并在结尾用要点列出本次主要改动与理由。
- 修改类请求要突出岗位关键词、可量化成果与动词开头的成就句式。
- 绝不能编造简历中不存在的经历、公司或数字。`;

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
