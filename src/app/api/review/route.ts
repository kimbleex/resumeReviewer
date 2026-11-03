import type { NextRequest } from "next/server";

import { parseLlmConfigFromFormData } from "@/lib/llm/config";
import { runWithLlmConfig } from "@/lib/llm/model";
import { runReviewPipeline, type ReviewPipelineResumeState } from "@/lib/review/pipeline";
import { reviewStreamChunkSchema, targetJobSchema, type ReviewStageEvent, type ReviewStreamChunk } from "@/lib/review/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 允许 Vercel 运行最长 5 分钟以支持多 Agent 流式会诊

function encodeChunk(encoder: TextEncoder, chunk: ReviewStreamChunk): Uint8Array {
  return encoder.encode(`${JSON.stringify(reviewStreamChunkSchema.parse(chunk))}\n`);
}

function parseResumeState(value: FormDataEntryValue | null): ReviewPipelineResumeState | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value) as ReviewPipelineResumeState;
  } catch {
    throw new Error("本地断点数据无效，请重新上传简历并启动诊断。");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const formData = await request.formData();
  const resumeFileValue = formData.get("resumeFile");
  const resumeFile = resumeFileValue instanceof File && resumeFileValue.size > 0 ? resumeFileValue : null;
  const targetRole = String(formData.get("targetRole") ?? "").trim();
  const targetDescription = String(formData.get("targetDescription") ?? "").trim();
  const resumeStateValue = formData.get("resumeState");

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamClosed = false;
      const markStreamClosed = () => {
        streamClosed = true;
      };
      request.signal.addEventListener("abort", markStreamClosed, { once: true });
      const push = (chunk: ReviewStreamChunk) => {
        if (streamClosed) {
          return;
        }

        try {
          controller.enqueue(encodeChunk(encoder, chunk));
        } catch {
          streamClosed = true;
        }
      };

      try {
        const resumeState = parseResumeState(resumeStateValue);
        const llmConfig = parseLlmConfigFromFormData(formData);

        if (!targetRole) {
          throw new Error("请填写目标岗位名称。");
        }

        if (!resumeFile && !resumeState?.document) {
          throw new Error("请先上传简历文件。");
        }

        const targetJob = targetJobSchema.parse({
          title: targetRole,
          description: targetDescription,
        });

        const result = await runWithLlmConfig(llmConfig, () =>
          runReviewPipeline(
            { resumeFile: resumeFile ?? new File([""], "cached-resume.txt", { type: "text/plain" }), targetJob },
            (event: ReviewStageEvent) => {
              push({ type: "event", event });
            },
            {},
            { resumeState, abortSignal: request.signal },
          ),
        );

        push({ type: "result", result });
      } catch (error) {
        push({
          type: "error",
          message: error instanceof Error ? error.message : "未知评审错误",
        });
      } finally {
        request.signal.removeEventListener("abort", markStreamClosed);
        if (!streamClosed) {
          try {
            controller.close();
          } catch {
            streamClosed = true;
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "none",
    },
  });
}
