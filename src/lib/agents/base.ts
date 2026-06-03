import { NoObjectGeneratedError, Output, streamText } from "ai";
import type { z } from "zod";

import { createLanguageModel } from "@/lib/llm";

export type StructuredAgentPhase =
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
    totalMs: readPositiveIntegerEnv("AGENT_TOTAL_TIMEOUT_MS", 180_000),
    chunkMs: readPositiveIntegerEnv("AGENT_CHUNK_TIMEOUT_MS", 90_000),
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
        message: "模型已接收请求，正在分析输入。",
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
    recordPartialOutput(partial: unknown) {
      if (hasOutputStreamed || partial === undefined) {
        return;
      }

      hasOutputStreamed = true;
      emitProgress({
        phase: "streaming_output",
        message: "模型正在生成结构化字段。",
      });
    },
    emitHeartbeat() {
      const elapsedSeconds = Math.max(0, Math.round((now() - startedAt) / 1000));
      const phaseMessages: Record<StructuredAgentPhase, string> = {
        requesting_model: `正在等待模型响应… (${elapsedSeconds}s)`,
        model_thinking: `模型正在深度思考与推理中… (${elapsedSeconds}s, 已推理 ${reasoningChunks} 轮)`,
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
  return JSON.stringify(value, null, 2);
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

export async function invokeStructuredAgent<TResponseFormat extends z.ZodTypeAny, TResult>(options: {
  name: string;
  systemPrompt: string;
  responseFormat: TResponseFormat;
  userContent: string;
  normalize: (value: z.infer<TResponseFormat>) => TResult;
  onProgress?: (event: StructuredAgentProgress) => void;
  abortSignal?: AbortSignal;
}): Promise<TResult> {
  let accumulatedText = "";
  let finishReason = "";
  let streamFailure: unknown;
  const progress = createStructuredAgentProgressTracker({
    name: options.name,
    onProgress: options.onProgress,
  });

  progress.start();

  const result = streamText({
    model: createLanguageModel(),
    system: options.systemPrompt,
    prompt: options.userContent,
    abortSignal: options.abortSignal,
    timeout: getStructuredAgentTimeout(),
    output: Output.object({
      name: options.name,
      schema: options.responseFormat,
    }),
    onError({ error }) {
      streamFailure = error;
    },
  });

  const heartbeatTimer = setInterval(() => progress.emitHeartbeat(), 8_000);

  const fullStreamTask = (async () => {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-delta": {
          progress.recordReasoningStarted();
          break;
        }
        case "text-delta": {
          accumulatedText += part.text;
          progress.recordTextDelta(part.text);
          break;
        }
        case "finish": {
          finishReason = part.finishReason;
          break;
        }
        case "error": {
          streamFailure = part.error;
          break;
        }
        default:
          break;
      }
    }
  })();

  try {
    const output = await result.output;

    options.onProgress?.({
      phase: "validating_output",
      message: "正在校验最终结构化结果。",
      details: finishReason ? [`finish_reason: ${finishReason}`] : [],
    });

    await fullStreamTask;
    return options.normalize(output as z.infer<TResponseFormat>);
  } catch (error) {
    await Promise.allSettled([fullStreamTask]);

    options.onProgress?.({
      phase: "validating_output",
      message: "最终结果校验失败，正在尝试恢复可用结构。",
      details: [structuredAgentErrorMessage(error)],
    });

    const recovered = tryRecoverResult({
      responseFormat: options.responseFormat,
      normalize: options.normalize,
      rawText: NoObjectGeneratedError.isInstance(error) ? error.text ?? accumulatedText : accumulatedText,
    });

    if (recovered) {
      options.onProgress?.({
        phase: "validating_output",
        message: "已从增量输出中恢复结构化结果。",
        details: ["采用流式片段完成最终解析。"],
      });
      return recovered;
    }

    if (streamFailure) {
      throw new Error(structuredAgentErrorMessage(streamFailure));
    }

    throw new Error(structuredAgentErrorMessage(error));
  } finally {
    clearInterval(heartbeatTimer);
  }
}
