import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/actors";
import { createMember, listUsers } from "@/lib/admin/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createUserSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "MEMBER"]).optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  return NextResponse.json({ users: await listUsers() });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const parsed = createUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "成员参数无效，密码至少 8 位。" }, { status: 400 });
  }

  const user = await createMember(parsed.data);
  return NextResponse.json({ user }, { status: 201 });
}
