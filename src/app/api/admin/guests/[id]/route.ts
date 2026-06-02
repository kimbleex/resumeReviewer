import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { updateGuest } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/actors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateGuestSchema = z.object({
  status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
  maxTrialCount: z.number().int().min(0).max(100).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = await requireAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const parsed = updateGuestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "游客更新参数无效。" }, { status: 400 });
  }

  const { id } = await context.params;
  const guest = await updateGuest(id, parsed.data);
  return NextResponse.json({ guest });
}
