import { NextRequest, NextResponse } from "next/server";

import { resolveUserSession } from "@/lib/auth/actors";
import { ensureInitialAdmin } from "@/lib/auth/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  await ensureInitialAdmin();

  const result = await resolveUserSession(request);
  if (!result.ok) {
    return NextResponse.json({ user: null, reason: result.reason }, { status: 200 });
  }

  return NextResponse.json({
    user: {
      id: result.user.id,
      username: result.user.username,
      role: result.user.role,
      status: result.user.status,
    },
  });
}
