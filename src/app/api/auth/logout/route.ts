import { NextRequest, NextResponse } from "next/server";

import { clearAuthCookies, REFRESH_TOKEN_COOKIE, clearGuestCookie } from "@/lib/auth/cookies";
import { revokeSessionByRefreshToken } from "@/lib/auth/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  if (refreshToken) {
    await revokeSessionByRefreshToken(refreshToken);
  }

  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  clearGuestCookie(response);
  return response;
}
