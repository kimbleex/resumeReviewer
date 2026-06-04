import type { NextRequest } from "next/server";

import { runResumeEditAgent, type ResumeAgentEvent } from "@/lib/agents/resume-edit";

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

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamClosed = false;
      const markStreamClosed = () => {
        streamClosed = true;
      };
      request.signal.addEventListener("abort", markStreamClosed, { once: true });

      const push = (event: ResumeAgentEvent) => {
        if (streamClosed) {
          return;
        }
        try {
          controller.enqueue(encodeEvent(encoder, event));
        } catch {
          streamClosed = true;
        }
      };

      try {
        if (!pdfFile) {
          throw new Error("请先上传简历 PDF 文件。");
        }
        if (!prompt) {
          throw new Error("请输入你希望 Agent 修改的内容。");
        }

        const fileBuffer = Buffer.from(await pdfFile.arrayBuffer());

        await runResumeEditAgent({
          fileName: pdfFile.name || "resume.pdf",
          fileBuffer,
          prompt,
          onEvent: push,
          abortSignal: request.signal,
        });
      } catch (error) {
        push({
          type: "error",
          message: error instanceof Error ? error.message : "Agent 调用失败。",
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
