import type { UserRole, UserStatus, GuestStatus, SessionStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { resetUserPassword, revokeUserSessions } from "@/lib/auth/sessions";

export async function listUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      username: true,
      role: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { sessions: true, reviewRuns: true } },
    },
  });
}

export async function createMember(options: { username: string; password: string; role?: UserRole }) {
  return prisma.user.create({
    data: {
      username: options.username,
      passwordHash: await hashPassword(options.password),
      role: options.role ?? "MEMBER",
      status: "ACTIVE",
    },
    select: {
      id: true,
      username: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });
}

export async function updateUserStatusAndRole(
  userId: string,
  data: { status?: UserStatus; role?: UserRole },
) {
  return prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      username: true,
      role: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
}

export async function resetMemberPassword(userId: string, password: string) {
  await resetUserPassword(userId, password);
}

export async function revokeAllMemberSessions(userId: string) {
  await revokeUserSessions(userId);
}

export async function listGuests() {
  return prisma.guestIdentity.findMany({
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      status: true,
      trialUsedCount: true,
      maxTrialCount: true,
      firstSeenAt: true,
      lastSeenAt: true,
      createdAt: true,
      _count: { select: { reviewRuns: true } },
    },
  });
}

export async function updateGuest(
  guestId: string,
  data: { status?: GuestStatus; maxTrialCount?: number },
) {
  return prisma.guestIdentity.update({
    where: { id: guestId },
    data,
    select: {
      id: true,
      status: true,
      trialUsedCount: true,
      maxTrialCount: true,
      firstSeenAt: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });
}

export async function listSessions() {
  return prisma.session.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      userAgentHash: true,
      ipHash: true,
      expiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
      user: { select: { id: true, username: true, role: true, status: true } },
    },
  });
}

export async function updateSessionStatus(sessionId: string, status: SessionStatus) {
  return prisma.session.update({
    where: { id: sessionId },
    data: {
      status,
      revokedAt: status === "REVOKED" ? new Date() : null,
    },
    select: {
      id: true,
      status: true,
      revokedAt: true,
    },
  });
}

export async function listReviewRuns() {
  return prisma.reviewRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 200,
    select: {
      id: true,
      actorType: true,
      status: true,
      targetRole: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
      user: { select: { id: true, username: true, role: true, status: true } },
      guest: { select: { id: true, status: true, trialUsedCount: true, maxTrialCount: true } },
    },
  });
}
