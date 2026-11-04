import { NoObjectGeneratedError, Output, streamText, type TextStreamPart, type ToolSet } from "ai";
import type { z } from "zod";

import { createLanguageModel } from "@/lib/llm/model";

type StructuredAgentPhase =
  | "requesting_model"
  | "model_thinking"
  | "streaming_output"
  | "validating_output";

export type StructuredAgentProgress = {
  phase: StructuredAgentPhase;
  message: string;
  details?: string[];
  snippet?: string;
  payload?: unknown;
  callId?: string;
  callLabel?: string;
};

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getStructuredAgentTimeout() {
  return {
    totalMs: readPositiveIntegerEnv("AGENT_TOTAL_TIMEOUT_MS", 270_000),
    chunkMs: readPositiveIntegerEnv("AGENT_CHUNK_TIMEOUT_MS", 120_000),
  };
}

export function createStructuredAgentProgressTracker(options: {
  name: string;
  onProgress?: (event: StructuredAgentProgress) => void;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const startedAt = now();
  let activePhase: StructuredAgentPhase = "requesting_model";
  let hasReasoningStarted = false;
  let hasOutputStreamed = false;
  let reasoningChunks = 0;

  const emitProgress = (event: StructuredAgentProgress) => {
    activePhase = event.phase;
    options.onProgress?.(event);
  };

  return {
    start() {
      emitProgress({
        phase: "requesting_model",
        message: "已向模型发送结构化请求。",
        details: [`schema: ${options.name}`],
      });
      emitProgress({
        phase: "model_thinking",
        message: "正在等待模型分析并返回结果。",
      });
    },
    recordReasoningStarted() {
      reasoningChunks++;
      if (hasReasoningStarted) {
        return;
      }

      hasReasoningStarted = true;
      emitProgress({
        phase: "model_thinking",
        message: "模型已启动思考链条，正在深入分析并规划输出结构。",
      });
    },
    recordTextDelta(text: string) {
      if (!text) {
        return;
      }

      if (hasOutputStreamed) {
        return;
      }

      hasOutputStreamed = true;
      emitProgress({
        phase: "streaming_output",
        message: "模型思考已完成，正在生成结构化诊断报告。",
      });
    },
    emitHeartbeat() {
      const elapsedSeconds = Math.max(0, Math.round((now() - startedAt) / 1000));
      const phaseMessages: Record<StructuredAgentPhase, string> = {
        requesting_model: `正在等待模型响应… (${elapsedSeconds}s)`,
        model_thinking: `模型正在深度思考与推理中… (${elapsedSeconds}s, 收到 ${reasoningChunks} 个推理片段)`,
        streaming_output: `模型正在生成结构化结果… (${elapsedSeconds}s)`,
        validating_output: `正在校验输出结构… (${elapsedSeconds}s)`,
      };
      emitProgress({
        phase: activePhase,
        message: phaseMessages[activePhase],
        details: [`${options.name} 已运行 ${elapsedSeconds} 秒`],
      });
    },
  };
}

export function dumpJson(value: unknown): string {
  return JSON.stringify(value);
}

function cleanStructuredText(text: string): string {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  return trimmed;
}

export function structuredAgentErrorMessage(error: unknown): string {
  if (NoObjectGeneratedError.isInstance(error)) {
    return "模型返回了无法直接解析的结构化结果。";
  }

  if (error instanceof Error) {
    if (/abort/i.test(error.message) || /Abort/i.test(error.name)) {
      return "诊断已被中断。";
    }
    if (/timeout|timed out/i.test(error.message) || /Timeout/i.test(error.name)) {
      return "模型调用超时，请稍后重试或换一个更快的模型。";
    }
    if (/Invalid JSON response/i.test(error.message)) {
      return "模型返回了无效 JSON，系统无法完成结构化解析。";
    }
    return error.message;
  }

  return "Agent 调用失败。";
}

function tryNormalizeResult<TResponseFormat extends z.ZodTypeAny, TResult>(options: {
  responseFormat: TResponseFormat;
  normalize: (value: z.infer<TResponseFormat>) => TResult;
  value: unknown;
}): TResult | null {
  const parsed = options.responseFormat.safeParse(options.value);
  if (parsed.success) {
    return options.normalize(parsed.data);
  }

  try {
    return options.normalize(options.value as z.infer<TResponseFormat>);
  } catch {
    return null;
  }
}

function tryRecoverResult<TResponseFormat extends z.ZodTypeAny, TResult>(options: {
  responseFormat: TResponseFormat;
  normalize: (value: z.infer<TResponseFormat>) => TResult;
  rawText: string;
}): TResult | null {
  const cleaned = cleanStructuredText(options.rawText);
  if (!cleaned) {
    return null;
  }

  try {
    const parsed = JSON.parse(cleaned);
    return tryNormalizeResult({
      responseFormat: options.responseFormat,
      normalize: options.normalize,
      value: parsed,
    });
  } catch {
    return null;
  }
}

type AgentRunOptions = {
  name: string;
  callLabel?: string;
  systemPrompt: string;
  userContent: string;
  onProgress?: (event: StructuredAgentProgress) => void;
  abortSignal?: AbortSignal;
};

type StreamCapture = {
  text: string;
  finishReason: string;
  failure: unknown;
};

function startAgentRun(options: AgentRunOptions) {
  const callId = globalThis.crypto.randomUUID();
  const startedAt = Date.now();
  const callLabel = options.callLabel ?? ({
    resume_parser: "事实提取",
    hr_agent: "HR 建议",
    interviewer_agent: "面试官建议",
    career_master_agent: "职业定位建议",
    summary_agent: "行动清单",
    rewrite_agent: "简历改写",
  } as Record<string, string>)[options.name] ?? options.name;
  const report = (event: StructuredAgentProgress) => options.onProgress?.({ ...event, callId, callLabel });
  const progress = createStructuredAgentProgressTracker({
    name: options.name,
    onProgress: report,
  });
  progress.start();

  const capture: StreamCapture = { text: "", finishReason: "", failure: undefined };
  const streamOptions = {
    model: createLanguageModel(),
    system: options.systemPrompt,
    prompt: options.userContent,
    abortSignal: options.abortSignal,
    timeout: getStructuredAgentTimeout(),
    maxRetries: 0,
    onError({ error }: { error: unknown }) {
      capture.failure = error;
    },
  };
  const heartbeatTimer = setInterval(() => progress.emitHeartbeat(), 8_000);

  async function consume(fullStream: AsyncIterable<TextStreamPart<ToolSet>>) {
    for await (const part of fullStream) {
      switch (part.type) {
        case "reasoning-delta":
          progress.recordReasoningStarted();
          break;
        case "text-delta":
          capture.text += part.text;
          progress.recordTextDelta(part.text);
          break;
        case "finish":
          capture.finishReason = part.finishReason;
          break;
        case "error":
          capture.failure = part.error;
          break;
        default:
          break;
      }
    }
  }

  function complete(usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number }) {
    report({
      phase: "validating_output",
      message: `${callLabel}调用完成 · ${Math.round((Date.now() - startedAt) / 1000)} 秒`,
      details: [
        `输入 ${usage.inputTokens ?? "未知"} token · 输出 ${usage.outputTokens ?? "未知"} token · 推理 ${usage.reasoningTokens ?? "未知"} token`,
        `结束原因: ${capture.finishReason || "未知"}`,
      ],
    });
  }
  return { capture, streamOptions, consume, report, complete, stop: () => clearInterval(heartbeatTimer) };
}

export async function invokeStructuredAgent<TResponseFormat extends z.ZodTypeAny, TResult>(
  options: AgentRunOptions & {
    responseFormat: TResponseFormat;
    normalize: (value: z.infer<TResponseFormat>) => TResult;
  },
): Promise<TResult> {
  const run = startAgentRun(options);
  const result = streamText({
    ...run.streamOptions,
    output: Output.object({
      name: options.name,
      schema: options.responseFormat,
    }),
  });
  const fullStreamTask = run.consume(result.fullStream);

  try {
    const output = await result.output;

    run.report({
      phase: "validating_output",
      message: "正在校验最终结构化结果。",
      details: run.capture.finishReason ? [`finish_reason: ${run.capture.finishReason}`] : [],
    });

    await fullStreamTask;
    if (run.capture.finishReason === "length") {
      throw new Error("模型输出被截断，请从当前步骤重试。");
    }
    const normalized = options.normalize(output as z.infer<TResponseFormat>);
    run.complete(await result.totalUsage);
    return normalized;
  } catch (error) {
    await Promise.allSettled([fullStreamTask]);

    run.report({
      phase: "validating_output",
      message: "最终结果校验失败，正在尝试恢复可用结构。",
      details: [structuredAgentErrorMessage(error)],
    });

    if (options.abortSignal?.aborted || run.capture.failure || run.capture.finishReason === "length") {
      throw new Error(run.capture.finishReason === "length"
        ? "模型输出被截断，请从当前步骤重试。"
        : structuredAgentErrorMessage(run.capture.failure ?? error));
    }
    const recovered = tryRecoverResult({
      responseFormat: options.responseFormat,
      normalize: options.normalize,
      rawText: NoObjectGeneratedError.isInstance(error) ? error.text ?? run.capture.text : run.capture.text,
    });

    if (recovered) {
      run.report({
        phase: "validating_output",
        message: "已从增量输出中恢复结构化结果。",
        details: ["采用流式片段完成最终解析。"],
      });
      run.complete(await result.totalUsage);
      return recovered;
    }

    throw new Error(structuredAgentErrorMessage(run.capture.failure ?? error));
  } finally {
    run.stop();
  }
}

export async function invokeTextAgent(options: AgentRunOptions): Promise<string> {
  const run = startAgentRun(options);
  const result = streamText(run.streamOptions);

  try {
    await run.consume(result.fullStream);

    if (run.capture.failure) {
      throw run.capture.failure;
    }

    if (options.abortSignal?.aborted) throw new Error("诊断已被中断。");
    if (run.capture.finishReason === "length") {
      throw new Error("模型输出被截断，请从当前步骤重试。");
    }
    if (!run.capture.text.trim()) throw new Error("模型未返回有效正文，请重试该步骤。");
    run.report({
      phase: "validating_output",
      message: "正在整理最终文本结果。",
      details: run.capture.finishReason ? [`finish_reason: ${run.capture.finishReason}`] : [],
    });

    run.complete(await result.totalUsage);
    return run.capture.text.trim();
  } catch (error) {
    run.report({
      phase: "validating_output",
      message: "文本结果生成失败，正在结束本次 Agent 调用。",
      details: [structuredAgentErrorMessage(error)],
    });
    throw new Error(structuredAgentErrorMessage(error));
  } finally {
    run.stop();
  }
}
