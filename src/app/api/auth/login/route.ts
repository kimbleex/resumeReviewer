import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getClientIp } from "@/lib/auth/actors";
import { ensureInitialAdmin } from "@/lib/auth/bootstrap";
import { setAuthCookies } from "@/lib/auth/cookies";
import { loginWithPassword } from "@/lib/auth/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  await ensureInitialAdmin();

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请输入用户名和密码。" }, { status: 400 });
  }

  const result = await loginWithPassword({
    username: parsed.data.username.trim(),
    password: parsed.data.password,
    userAgent: request.headers.get("user-agent"),
    ipAddress: getClientIp(request),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason === "USER_BLOCKED" ? "账号已被管理员禁用。" : "用户名或密码错误。" },
      { status: 401 },
    );
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
