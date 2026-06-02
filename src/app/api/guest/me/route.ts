import { NextRequest, NextResponse } from "next/server";

import { resolveGuest } from "@/lib/auth/actors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = await resolveGuest(request);
  if (!result.ok) {
    return NextResponse.json({ guest: null }, { status: 200 });
  }

  const remainingTrialCount = Math.max(0, result.guest.maxTrialCount - result.guest.trialUsedCount);

  return NextResponse.json({
    guest: {
      id: result.guest.id,
      status: result.guest.status,
      trialUsedCount: result.guest.trialUsedCount,
      maxTrialCount: result.guest.maxTrialCount,
      remainingTrialCount,
    },
  });
}
