import type { NextRequest } from "next/server";

import { runResumeEditAgent, type ResumeAgentEvent } from "@/lib/agents/resume-chat";
import { parseLlmConfigFromFormData } from "@/lib/llm/config";
import { runWithLlmConfig } from "@/lib/llm/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 允许工具调用 + 流式生成最长 5 分钟

function encodeEvent(encoder: TextEncoder, event: ResumeAgentEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

export async function POST(request: NextRequest): Promise<Response> {
  const formData = await request.formData();
  const fileValue = formData.get("pdfFile");
  const pdfFile = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  const prompt = String(formData.get("prompt") ?? "").trim();
  const parsedResumeContent = String(formData.get("parsedResumeContent") ?? "").trim();
  const parsedResumeFileName = String(formData.get("parsedResumeFileName") ?? "").trim();
  const parsedResumeCharCount = Number(formData.get("parsedResumeCharCount") ?? 0);
  const parsedResume = parsedResumeContent
    ? {
        fileName: parsedResumeFileName || pdfFile?.name || "resume.pdf",
        charCount: Number.isFinite(parsedResumeCharCount) && parsedResumeCharCount > 0
          ? parsedResumeCharCount
          : parsedResumeContent.length,
        content: parsedResumeContent,
      }
    : undefined;

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();

  let streamClosed = false;
  let writeQueue = Promise.resolve();
  const markStreamClosed = () => {
    streamClosed = true;
  };
  request.signal.addEventListener("abort", markStreamClosed, { once: true });

  const push = (event: ResumeAgentEvent) => {
    if (streamClosed) {
      return;
    }
    writeQueue = writeQueue
      .then(() => writer.write(encodeEvent(encoder, event)))
      .catch(() => {
        streamClosed = true;
      });
  };

  void (async () => {
    try {
      if (!pdfFile && !parsedResume) {
        throw new Error("请先上传简历 PDF 文件。");
      }
      if (!prompt) {
        throw new Error("请输入你希望 Agent 修改的内容。");
      }

      const llmConfig = parseLlmConfigFromFormData(formData);
      const fileBuffer = pdfFile ? Buffer.from(await pdfFile.arrayBuffer()) : Buffer.alloc(0);

      await runWithLlmConfig(llmConfig, () =>
        runResumeEditAgent({
          fileName: pdfFile?.name || parsedResume?.fileName || "resume.pdf",
          fileBuffer,
          prompt,
          parsedResume: parsedResume,
          onEvent: push,
          abortSignal: request.signal,
        }),
      );
    } catch (error) {
      push({
        type: "error",
        message: error instanceof Error ? error.message : "Agent 调用失败。",
      });
    } finally {
      request.signal.removeEventListener("abort", markStreamClosed);
      await writeQueue;
      if (!streamClosed) {
        await writer.close().catch(() => {
          streamClosed = true;
        });
      }
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "none",
    },
  });
}
