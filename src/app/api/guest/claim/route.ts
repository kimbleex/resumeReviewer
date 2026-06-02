import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  clearGuestChallengeCookie,
  GUEST_CHALLENGE_COOKIE,
  setGuestCookie,
} from "@/lib/auth/cookies";
import { claimGuestIdentity, sameHash, verifyGuestSignature } from "@/lib/auth/guest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const claimSchema = z.object({
  challenge: z.string().min(1),
  publicKeyPem: z.string().min(1),
  signatureBase64: z.string().min(1),
  fingerprint: z.object({
    userAgent: z.string().optional(),
    language: z.string().optional(),
    timezone: z.string().optional(),
    platform: z.string().optional(),
  }),
});

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = claimSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "游客身份参数无效。" }, { status: 400 });
  }

  const challengeCookie = request.cookies.get(GUEST_CHALLENGE_COOKIE)?.value;
  if (!challengeCookie || !sameHash(hash(challengeCookie), hash(parsed.data.challenge))) {
    return NextResponse.json({ error: "游客验证已过期，请重试。" }, { status: 400 });
  }

  const signatureOk = verifyGuestSignature({
    publicKeyPem: parsed.data.publicKeyPem,
    challenge: parsed.data.challenge,
    signatureBase64: parsed.data.signatureBase64,
  });
  if (!signatureOk) {
    return NextResponse.json({ error: "游客设备签名验证失败。" }, { status: 400 });
  }

  const guest = await claimGuestIdentity({
    fingerprint: parsed.data.fingerprint,
    publicKeyPem: parsed.data.publicKeyPem,
  });
  const remainingTrialCount = Math.max(0, guest.maxTrialCount - guest.trialUsedCount);
  const response = NextResponse.json({
    guest: {
      id: guest.id,
      status: guest.status,
      trialUsedCount: guest.trialUsedCount,
      maxTrialCount: guest.maxTrialCount,
      remainingTrialCount,
    },
  });
  setGuestCookie(response, guest.id);
  clearGuestChallengeCookie(response);
  return response;
}
