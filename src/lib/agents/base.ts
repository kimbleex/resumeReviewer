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

function trimSnippet(text: string, limit = 260): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
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
  let latestPartialSnapshot = "";
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

  const fullStreamTask = (async () => {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-delta": {
          const snippet = trimSnippet(part.text);
          if (!snippet) {
            break;
          }

          emitProgress({
            phase: "model_thinking",
            message: "模型正在推理并整理结构化字段。",
            snippet,
            payload: {
              streamType: "reasoning",
            },
          });
          break;
        }
        case "text-delta": {
          accumulatedText += part.text;
          const snippet = trimSnippet(part.text);

          if (!hasOutputStreamed) {
            hasOutputStreamed = true;
            emitProgress({
              phase: "streaming_output",
              message: "模型开始输出结构化结果。",
              snippet,
              payload: {
                streamType: "output_text",
              },
            });
            break;
          }

          if (snippet) {
            emitProgress({
              phase: "streaming_output",
              message: "模型正在持续输出结构化结果。",
              snippet,
              payload: {
                streamType: "output_text",
              },
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

      const snapshot = JSON.stringify(partial);
      if (!snapshot || snapshot === latestPartialSnapshot) {
        continue;
      }

      latestPartialSnapshot = snapshot;
      emitProgress({
        phase: "streaming_output",
        message: "结构化字段正在增量生成。",
        snippet: trimSnippet(snapshot),
        payload: {
          streamType: "partial_object",
          partialObject: partial,
        },
      });
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
