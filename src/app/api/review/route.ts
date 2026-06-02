import type { NextRequest } from "next/server";

import { authErrorMessage, resolveReviewActor } from "@/lib/auth/actors";
import { reserveGuestTrial } from "@/lib/auth/guest";
import { prisma } from "@/lib/db/prisma";
import { runReviewPipeline } from "@/lib/review/pipeline";
import { reviewStreamChunkSchema, targetJobSchema, type ReviewStageEvent, type ReviewStreamChunk } from "@/lib/review/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // 允许 Vercel 运行最长 60 秒以支持多 Agent 流式会诊

function encodeChunk(encoder: TextEncoder, chunk: ReviewStreamChunk): Uint8Array {
  return encoder.encode(`${JSON.stringify(reviewStreamChunkSchema.parse(chunk))}\n`);
}

export async function POST(request: NextRequest): Promise<Response> {
  const actorResult = await resolveReviewActor(request);
  const formData = await request.formData();
  const resumeFileValue = formData.get("resumeFile");
  const resumeFile = resumeFileValue instanceof File && resumeFileValue.size > 0 ? resumeFileValue : null;
  const targetRole = String(formData.get("targetRole") ?? "").trim();
  const targetDescription = String(formData.get("targetDescription") ?? "").trim();

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (chunk: ReviewStreamChunk) => controller.enqueue(encodeChunk(encoder, chunk));
      let reviewRunId: string | null = null;

      try {
        if (!actorResult.ok) {
          throw new Error(authErrorMessage(actorResult.reason));
        }
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

        if (actorResult.actor.type === "GUEST") {
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
          { resumeFile, targetJob },
          (event: ReviewStageEvent) => {
            push({ type: "event", event });
          },
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
