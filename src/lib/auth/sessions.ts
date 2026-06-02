import type { SessionStatus, UserRole, UserStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

import { hashPassword, verifyPassword } from "./password";
import { createAccessToken, createRefreshToken, hashRefreshToken } from "./tokens";

const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type SessionDecisionReason = "USER_BLOCKED" | "SESSION_REVOKED" | "SESSION_EXPIRED";

export type SessionDecision =
  | { ok: true }
  | { ok: false; reason: SessionDecisionReason };

export function canUseUserSession(options: {
  userStatus: UserStatus;
  sessionStatus: SessionStatus;
  expiresAt: Date;
  now?: Date;
}): SessionDecision {
  if (options.userStatus !== "ACTIVE") {
    return { ok: false, reason: "USER_BLOCKED" };
  }

  if (options.sessionStatus !== "ACTIVE") {
    return { ok: false, reason: "SESSION_REVOKED" };
  }

  if (options.expiresAt.getTime() <= (options.now ?? new Date()).getTime()) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }

  return { ok: true };
}

export function hashRequestSignal(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return hashRefreshToken(value.trim().toLowerCase());
}

export async function createSessionForUser(options: {
  userId: string;
  role: UserRole;
  userAgent?: string | null;
  ipAddress?: string | null;
}) {
  const refreshToken = createRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const session = await prisma.session.create({
    data: {
      userId: options.userId,
      refreshTokenHash,
      userAgentHash: hashRequestSignal(options.userAgent),
      ipHash: hashRequestSignal(options.ipAddress),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  const accessToken = await createAccessToken({
    userId: options.userId,
    sessionId: session.id,
    role: options.role,
  });

  return { accessToken, refreshToken, session };
}

export async function loginWithPassword(options: {
  username: string;
  password: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}) {
  const user = await prisma.user.findUnique({ where: { username: options.username } });

  if (!user || !(await verifyPassword(user.passwordHash, options.password))) {
    return { ok: false as const, reason: "INVALID_CREDENTIALS" as const };
  }

  if (user.status !== "ACTIVE") {
    return { ok: false as const, reason: "USER_BLOCKED" as const };
  }

  const tokens = await createSessionForUser({
    userId: user.id,
    role: user.role,
    userAgent: options.userAgent,
    ipAddress: options.ipAddress,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return { ok: true as const, user, ...tokens };
}

export async function refreshUserSession(refreshToken: string) {
  const currentHash = hashRefreshToken(refreshToken);
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: currentHash },
    include: { user: true },
  });

  if (!session) {
    return { ok: false as const, reason: "SESSION_REVOKED" as const };
  }

  const decision = canUseUserSession({
    userStatus: session.user.status,
    sessionStatus: session.status,
    expiresAt: session.expiresAt,
  });

  if (!decision.ok) {
    return { ok: false as const, reason: decision.reason };
  }

  const nextRefreshToken = createRefreshToken();
  const updatedSession = await prisma.session.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: hashRefreshToken(nextRefreshToken),
      lastUsedAt: new Date(),
    },
  });
  const accessToken = await createAccessToken({
    userId: session.userId,
    sessionId: session.id,
    role: session.user.role,
  });

  return {
    ok: true as const,
    accessToken,
    refreshToken: nextRefreshToken,
    session: updatedSession,
    user: session.user,
  };
}

export async function revokeSessionByRefreshToken(refreshToken: string): Promise<void> {
  await prisma.session.updateMany({
    where: { refreshTokenHash: hashRefreshToken(refreshToken), status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
}

export async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
}

export async function resetUserPassword(userId: string, password: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password) },
    }),
    prisma.session.updateMany({
      where: { userId, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date() },
    }),
  ]);
}
