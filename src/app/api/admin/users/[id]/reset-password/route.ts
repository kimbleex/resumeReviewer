import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resetMemberPassword } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/actors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resetPasswordSchema = z.object({
  password: z.string().min(8),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = await requireAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "新密码至少 8 位。" }, { status: 400 });
  }

  const { id } = await context.params;
  await resetMemberPassword(id, parsed.data.password);
  return NextResponse.json({ ok: true });
}
