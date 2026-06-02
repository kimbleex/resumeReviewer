import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { updateSessionStatus } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/actors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSessionSchema = z.object({
  status: z.enum(["ACTIVE", "REVOKED", "EXPIRED"]),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = await requireAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const parsed = updateSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "会话更新参数无效。" }, { status: 400 });
  }

  const { id } = await context.params;
  const session = await updateSessionStatus(id, parsed.data.status);
  return NextResponse.json({ session });
}
