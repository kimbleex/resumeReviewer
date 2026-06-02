import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { updateUserStatusAndRole } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/actors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateUserSchema = z.object({
  status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
  role: z.enum(["ADMIN", "MEMBER"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = await requireAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const parsed = updateUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "用户更新参数无效。" }, { status: 400 });
  }

  const { id } = await context.params;
  const user = await updateUserStatusAndRole(id, parsed.data);
  return NextResponse.json({ user });
}
