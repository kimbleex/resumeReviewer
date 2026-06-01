import { runReviewPipeline } from "@/lib/review/pipeline";
import { reviewStreamChunkSchema, targetJobSchema, type ReviewStageEvent, type ReviewStreamChunk } from "@/lib/review/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeChunk(encoder: TextEncoder, chunk: ReviewStreamChunk): Uint8Array {
  return encoder.encode(`${JSON.stringify(reviewStreamChunkSchema.parse(chunk))}\n`);
}

export async function POST(request: Request): Promise<Response> {
  const formData = await request.formData();
  const resumeFileValue = formData.get("resumeFile");
  const resumeFile = resumeFileValue instanceof File && resumeFileValue.size > 0 ? resumeFileValue : null;
  const targetRole = String(formData.get("targetRole") ?? "").trim();
  const targetDescription = String(formData.get("targetDescription") ?? "").trim();

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (chunk: ReviewStreamChunk) => controller.enqueue(encodeChunk(encoder, chunk));

      try {
        if (!resumeFile) {
          throw new Error("请先上传简历文件。");
        }
        if (!targetRole) {
          throw new Error("请填写目标岗位名称。");
        }

        const targetJob = targetJobSchema.parse({
          title: targetRole,
          description: targetDescription,
        });

        const result = await runReviewPipeline(
          { resumeFile, targetJob },
          (event: ReviewStageEvent) => {
            push({ type: "event", event });
          },
        );

        push({ type: "result", result });
      } catch (error) {
        push({
          type: "error",
          message: error instanceof Error ? error.message : "未知评审错误",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
