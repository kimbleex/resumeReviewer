import type { NextRequest } from "next/server";

import { authErrorMessage, resolveReviewActor } from "@/lib/auth/actors";
import { reserveGuestTrial } from "@/lib/auth/guest";
import { prisma } from "@/lib/db/prisma";
import { runReviewPipeline, type ReviewPipelineResumeState } from "@/lib/review/pipeline";
import { reviewStreamChunkSchema, targetJobSchema, type ReviewStageEvent, type ReviewStreamChunk } from "@/lib/review/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // 允许 Vercel 运行最长 60 秒以支持多 Agent 流式会诊

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
      let reviewRunId: string | null = null;

      try {
        const resumeState = parseResumeState(resumeStateValue);
        const isResumingLocalRun = Boolean(resumeState?.document);
        const actorResult = await resolveReviewActor(request, { allowExhaustedGuest: isResumingLocalRun });

        if (!actorResult.ok) {
          throw new Error(authErrorMessage(actorResult.reason));
        }
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

        if (actorResult.actor.type === "GUEST" && !isResumingLocalRun) {
          const reservation = await reserveGuestTrial(actorResult.actor.guest.id);
          if (!reservation.ok) {
            throw new Error(authErrorMessage(reservation.reason));
          }
        }

        const reviewRun = await prisma.reviewRun.create({
          data:
            actorResult.actor.type === "USER"
              ? {
                  actorType: "USER",
                  userId: actorResult.actor.user.id,
                  targetRole: targetJob.title,
                }
              : {
                  actorType: "GUEST",
                  guestId: actorResult.actor.guest.id,
                  targetRole: targetJob.title,
                },
        });
        reviewRunId = reviewRun.id;

        const result = await runReviewPipeline(
          { resumeFile: resumeFile ?? new File([""], "cached-resume.txt", { type: "text/plain" }), targetJob },
          (event: ReviewStageEvent) => {
            push({ type: "event", event });
          },
          {},
          { resumeState, abortSignal: request.signal },
        );

        await prisma.reviewRun.update({
          where: { id: reviewRunId },
          data: { status: "COMPLETED", completedAt: new Date() },
        });

        push({ type: "result", result });
      } catch (error) {
        if (reviewRunId) {
          await prisma.reviewRun.update({
            where: { id: reviewRunId },
            data: {
              status: "FAILED",
              completedAt: new Date(),
              errorMessage: error instanceof Error ? error.message : "未知评审错误",
            },
          });
        }
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
