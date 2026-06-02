import { NextRequest, NextResponse } from "next/server";

import { clearAuthCookies, REFRESH_TOKEN_COOKIE, setAuthCookies } from "@/lib/auth/cookies";
import { refreshUserSession } from "@/lib/auth/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) {
    const response = NextResponse.json({ error: "请重新登录。" }, { status: 401 });
    clearAuthCookies(response);
    return response;
  }

  const result = await refreshUserSession(refreshToken);
  if (!result.ok) {
    const response = NextResponse.json({ error: "会话已失效，请重新登录。" }, { status: 401 });
    clearAuthCookies(response);
    return response;
  }

  const response = NextResponse.json({
    user: {
      id: result.user.id,
      username: result.user.username,
      role: result.user.role,
      status: result.user.status,
    },
  });
  setAuthCookies(response, {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  });
  return response;
}
