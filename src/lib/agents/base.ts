import { NoObjectGeneratedError, Output, streamText, type DeepPartial } from "ai";
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

function toErrorMessage(error: unknown): string {
  if (NoObjectGeneratedError.isInstance(error)) {
    return "模型返回了无法直接解析的结构化结果。";
  }

  if (error instanceof Error) {
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
  partialValue: DeepPartial<z.infer<TResponseFormat>> | undefined;
}): TResult | null {
  if (options.partialValue !== undefined) {
    const partialResult = tryNormalizeResult({
      responseFormat: options.responseFormat,
      normalize: options.normalize,
      value: options.partialValue,
    });
    if (partialResult) {
      return partialResult;
    }
  }

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
}): Promise<TResult> {
  let latestPartialValue: DeepPartial<z.infer<TResponseFormat>> | undefined;
  let accumulatedText = "";
  let hasOutputStreamed = false;
  let finishReason = "";
  let streamFailure: unknown;

  const emitProgress = (event: StructuredAgentProgress) => {
    options.onProgress?.(event);
  };

  emitProgress({
    phase: "requesting_model",
    message: "已向模型发送结构化请求。",
    details: [`schema: ${options.name}`],
  });
  emitProgress({
    phase: "model_thinking",
    message: "模型已接收请求，正在分析输入。",
  });

  const result = streamText({
    model: createLanguageModel(),
    system: options.systemPrompt,
    prompt: options.userContent,
    output: Output.object({
      name: options.name,
      schema: options.responseFormat,
    }),
    onError({ error }) {
      streamFailure = error;
    },
  });

  let hasReasoningStarted = false;

  const fullStreamTask = (async () => {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-delta": {
          if (!hasReasoningStarted) {
            hasReasoningStarted = true;
            emitProgress({
              phase: "model_thinking",
              message: "模型已启动思考链条，正在深入分析并规划输出结构。",
            });
          }
          break;
        }
        case "text-delta": {
          accumulatedText += part.text;
          if (!hasOutputStreamed) {
            hasOutputStreamed = true;
            emitProgress({
              phase: "streaming_output",
              message: "模型思考已完成，开始生成结构化诊断报告信息体。",
            });
          }
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

  const partialStreamTask = (async () => {
    for await (const partial of result.partialOutputStream) {
      latestPartialValue = partial as DeepPartial<z.infer<TResponseFormat>>;
    }
  })();

  try {
    const output = await result.output;

    emitProgress({
      phase: "validating_output",
      message: "正在校验最终结构化结果。",
      details: finishReason ? [`finish_reason: ${finishReason}`] : [],
    });

    await Promise.all([fullStreamTask, partialStreamTask]);
    return options.normalize(output as z.infer<TResponseFormat>);
  } catch (error) {
    await Promise.allSettled([fullStreamTask, partialStreamTask]);

    emitProgress({
      phase: "validating_output",
      message: "最终结果校验失败，正在尝试恢复可用结构。",
      details: [toErrorMessage(error)],
    });

    const recovered = tryRecoverResult({
      responseFormat: options.responseFormat,
      normalize: options.normalize,
      rawText: NoObjectGeneratedError.isInstance(error) ? error.text ?? accumulatedText : accumulatedText,
      partialValue: latestPartialValue,
    });

    if (recovered) {
      emitProgress({
        phase: "validating_output",
        message: "已从增量输出中恢复结构化结果。",
        details: ["采用流式片段完成最终解析。"],
      });
      return recovered;
    }

    if (streamFailure) {
      throw new Error(toErrorMessage(streamFailure));
    }

    throw new Error(toErrorMessage(error));
  }
}
