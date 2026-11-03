import { APICallError, generateText } from "ai";

import { LLM_PROTOCOLS, llmConnectionSchema, type LlmConnection, type LlmProtocol } from "@/lib/llm/config";
import { createLanguageModel } from "@/lib/llm/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEST_TIMEOUT_MS = 30_000;

export type LlmProtocolTestResult = {
  protocol: LlmProtocol;
  ok: boolean;
  durationMs: number;
  details: string;
};

function describeError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    return JSON.stringify(
      {
        url: error.url,
        statusCode: error.statusCode,
        message: error.message,
        responseBody: error.responseBody,
      },
      null,
      2,
    );
  }

  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `\ncause: ${error.cause.message}` : "";
    return `${error.name}: ${error.message}${cause}`;
  }

  return String(error);
}

async function testProtocol(connection: LlmConnection, protocol: LlmProtocol): Promise<LlmProtocolTestResult> {
  const startedAt = Date.now();
  try {
    const result = await generateText({
      model: createLanguageModel({ ...connection, protocol }),
      prompt: "hi",
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    return {
      protocol,
      ok: true,
      durationMs: Date.now() - startedAt,
      details: JSON.stringify(
        {
          model: result.response.modelId,
          text: result.text,
          finishReason: result.finishReason,
          usage: result.usage,
          responseBody: result.response.body,
        },
        null,
        2,
      ),
    };
  } catch (error) {
    return { protocol, ok: false, durationMs: Date.now() - startedAt, details: describeError(error) };
  }
}

// 用同一份连接信息，按每种协议各发送一次 "hi"，返回全部协议的测试结果。
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "请求体不是合法的 JSON。" }, { status: 400 });
  }

  const parsed = llmConnectionSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "模型配置无效。" }, { status: 400 });
  }

  const results = await Promise.all(LLM_PROTOCOLS.map(({ value }) => testProtocol(parsed.data, value)));
  return Response.json({ results });
}
