import { prisma } from "@/lib/db/prisma";
import { loadAppEnv } from "@/lib/env";

import { hashPassword } from "./password";

let bootstrapPromise: Promise<void> | null = null;

async function bootstrapInitialAdmin() {
  loadAppEnv();

  const username = process.env.ADMIN?.trim();
  const password = process.env.ADMIN_PWD;

  if (!username || !password) {
    return;
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return;
  }

  await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword(password),
      role: "ADMIN",
      status: "ACTIVE",
    },
  });
}

export function ensureInitialAdmin(): Promise<void> {
  bootstrapPromise ??= bootstrapInitialAdmin();
  return bootstrapPromise;
}
