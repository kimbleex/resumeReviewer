import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

import { getStructuredAgentTimeout, structuredAgentErrorMessage } from "@/lib/agents/base";
import { createLanguageModel } from "@/lib/llm";
import { extractResumeText } from "@/lib/resume/loader";

/**
 * 当用户的问题与"修改简历"无关时，Agent 必须原样返回这句话。
 * 前后端共享，避免出现细微差异。
 */
export const RESUME_EDIT_REFUSAL = "我无法完成非修改简历相关的内容";

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
  | { type: "done"; citation: string }
  | { type: "error"; message: string };

const RESUME_EDIT_SYSTEM_PROMPT = `你是一名专业的简历修改助手（Resume Assistant，简称 RA）。你唯一的职责是帮助用户修改、优化、润色、重写简历。

# 工作流程
1. 你必须首先调用 read_resume_pdf 工具，读取并解析用户上传的简历原文。没有拿到原文之前，禁止进行任何修改。
2. 拿到简历原文后，结合用户的具体要求，对简历做有针对性的修改、润色或重写，并给出清晰的修改结果与简要说明。

# 严格的相关性约束（最重要）
- 只要用户的问题与"修改这份简历"无关（例如闲聊、写代码、查天气、数学题、通用问答、与简历内容无关的请求等），你必须直接、逐字输出下面这句话，并且不要输出任何其他内容、不要调用任何工具：
${RESUME_EDIT_REFUSAL}

# 输出要求（仅当与简历修改相关时）
- 使用 Markdown 输出，结构清晰。
- 给出"修改后的内容"，并在结尾用要点列出本次主要改动与理由。
- 突出岗位关键词、可量化成果与动词开头的成就句式。
- 绝不能编造简历中不存在的经历、公司或数字。`;

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
  onEvent: (event: ResumeAgentEvent) => void;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { fileName, fileBuffer, prompt, onEvent, abortSignal } = options;

  let toolCallCount = 0;
  let parsedChars = 0;
  let answerStarted = false;
  let readingDone = false;

  const markReadingDone = () => {
    if (readingDone) {
      return;
    }
    readingDone = true;
    onEvent({
      type: "step",
      id: READING_STEP_ID,
      tag: "agent",
      title: "RA 正在读取问题",
      status: "done",
    });
  };

  const readResumeTool = tool({
    description:
      "读取并解析用户上传的简历文件（PDF / DOCX / 文本），返回简历纯文本内容。进行任何简历修改前都必须先调用本工具拿到原文。",
    inputSchema: z.object({
      focus: z
        .string()
        .optional()
        .describe("可选：本次需要重点关注或修改的简历部分，例如'项目经历'、'技能'。"),
    }),
    execute: async () => {
      const text = (await extractResumeText(fileName, fileBuffer)).trim();
      if (!text) {
        throw new Error(`简历文件内容为空或无法解析：${fileName}`);
      }
      parsedChars = text.length;
      // 截断超长正文，避免一次性把巨量文本塞进上下文。
      return {
        fileName,
        charCount: text.length,
        content: text.length > 12_000 ? `${text.slice(0, 12_000)}\n…（已截断）` : text,
      };
    },
  });

  // 起始：读取问题中（前端展示转圈动画），收到模型首个动作后再标记完成。
  onEvent({
    type: "step",
    id: READING_STEP_ID,
    tag: "agent",
    title: "RA 正在读取问题",
    status: "running",
  });

  const result = streamText({
    model: createLanguageModel(),
    system: RESUME_EDIT_SYSTEM_PROMPT,
    prompt: prompt.trim(),
    tools: { read_resume_pdf: readResumeTool },
    stopWhen: stepCountIs(4),
    abortSignal,
    timeout: getStructuredAgentTimeout(),
  });

  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "tool-call": {
          markReadingDone();
          toolCallCount++;
          onEvent({
            type: "step",
            id: `tool-${part.toolCallId}`,
            tag: "model",
            title: `调用工具：${part.toolName}`,
            detail: JSON.stringify(part.input ?? {}),
            status: "running",
          });
          break;
        }
        case "tool-result": {
          const output = part.output as { charCount?: number } | undefined;
          onEvent({
            type: "step",
            id: `tool-${part.toolCallId}`,
            tag: "model",
            title: `调用工具：${part.toolName}`,
            detail: `已解析简历，提取 ${output?.charCount ?? parsedChars} 字`,
            status: "done",
          });
          break;
        }
        case "tool-error": {
          onEvent({
            type: "step",
            id: `tool-${part.toolCallId}`,
            tag: "model",
            title: `调用工具：${part.toolName}`,
            detail: structuredAgentErrorMessage(part.error),
            status: "failed",
          });
          throw part.error;
        }
        case "text-delta": {
          markReadingDone();
          if (!answerStarted) {
            answerStarted = true;
            // 生成中：先展示转圈动画，流结束后再标记完成。
            onEvent({
              type: "step",
              id: GENERATING_STEP_ID,
              tag: "model",
              title: "模型生成回答",
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
        title: "模型生成回答",
        status: "done",
      });
    }

    const citation =
      toolCallCount > 0
        ? `已读取并解析简历：${fileName} · 提取 ${parsedChars} 字`
        : "";
    onEvent({ type: "done", citation });
  } catch (error) {
    // 把当前正在运行的步骤标记为失败，避免一直转圈。
    if (answerStarted) {
      onEvent({
        type: "step",
        id: GENERATING_STEP_ID,
        tag: "model",
        title: "模型生成回答",
        status: "failed",
      });
    } else if (!readingDone) {
      onEvent({
        type: "step",
        id: READING_STEP_ID,
        tag: "agent",
        title: "RA 正在读取问题",
        status: "failed",
      });
    }
    onEvent({ type: "error", message: structuredAgentErrorMessage(error) });
  }
}
