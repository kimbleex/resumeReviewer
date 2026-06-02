import { NextResponse } from "next/server";

import { setGuestChallengeCookie } from "@/lib/auth/cookies";
import { createGuestChallenge } from "@/lib/auth/guest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const challenge = createGuestChallenge();
  const response = NextResponse.json({ challenge });
  setGuestChallengeCookie(response, challenge);
  return response;
}
