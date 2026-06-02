import { NextRequest, NextResponse } from "next/server";

import { revokeAllMemberSessions } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/actors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = await requireAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const { id } = await context.params;
  await revokeAllMemberSessions(id);
  return NextResponse.json({ ok: true });
}
