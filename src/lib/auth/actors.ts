import type { GuestIdentity, Session, User } from "@prisma/client";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/db/prisma";

import { ACCESS_TOKEN_COOKIE, GUEST_ID_COOKIE } from "./cookies";
import { canUseGuestTrial } from "./guest";
import { canUseUserSession } from "./sessions";
import { verifyAccessToken } from "./tokens";

export type AuthenticatedUser = User & {
  sessions?: Session[];
};

export type ReviewActor =
  | { type: "USER"; user: User; session: Session }
  | { type: "GUEST"; guest: GuestIdentity };

export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }

  return request.headers.get("x-real-ip");
}

export async function resolveUserSession(request: NextRequest | Request) {
  const accessToken =
    "cookies" in request
      ? request.cookies.get(ACCESS_TOKEN_COOKIE)?.value
      : null;

  if (!accessToken) {
    return { ok: false as const, reason: "LOGIN_REQUIRED" as const };
  }

  try {
    const payload = await verifyAccessToken(accessToken);
    const session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });

    if (!session || session.userId !== payload.userId) {
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

    return { ok: true as const, user: session.user, session };
  } catch {
    return { ok: false as const, reason: "LOGIN_REQUIRED" as const };
  }
}

export async function requireAdmin(request: NextRequest | Request) {
  const userSession = await resolveUserSession(request);

  if (!userSession.ok) {
    return userSession;
  }

  if (userSession.user.role !== "ADMIN") {
    return { ok: false as const, reason: "ADMIN_REQUIRED" as const };
  }

  return userSession;
}

export async function resolveGuest(request: NextRequest | Request) {
  const guestId =
    "cookies" in request
      ? request.cookies.get(GUEST_ID_COOKIE)?.value
      : null;

  if (!guestId) {
    return { ok: false as const, reason: "GUEST_REQUIRED" as const };
  }

  const guest = await prisma.guestIdentity.findUnique({ where: { id: guestId } });
  if (!guest) {
    return { ok: false as const, reason: "GUEST_REQUIRED" as const };
  }

  return { ok: true as const, guest };
}

export async function resolveReviewActor(
  request: NextRequest | Request,
  options: { allowExhaustedGuest?: boolean } = {},
) {
  const userSession = await resolveUserSession(request);
  if (userSession.ok) {
    return {
      ok: true as const,
      actor: { type: "USER" as const, user: userSession.user, session: userSession.session },
    };
  }

  const guestSession = await resolveGuest(request);
  if (!guestSession.ok) {
    return { ok: false as const, reason: "LOGIN_OR_GUEST_REQUIRED" as const };
  }

  const decision = canUseGuestTrial(guestSession.guest);
  if (!decision.ok && !(options.allowExhaustedGuest && decision.reason === "GUEST_TRIAL_EXHAUSTED")) {
    return { ok: false as const, reason: decision.reason };
  }

  return {
    ok: true as const,
    actor: { type: "GUEST" as const, guest: guestSession.guest },
  };
}

export function authErrorMessage(reason: string): string {
  switch (reason) {
    case "USER_BLOCKED":
      return "账号已被管理员禁用。";
    case "SESSION_REVOKED":
    case "SESSION_EXPIRED":
    case "LOGIN_REQUIRED":
      return "请先登录后再继续。";
    case "ADMIN_REQUIRED":
      return "需要管理员权限。";
    case "GUEST_BLOCKED":
      return "游客身份已被管理员禁用。";
    case "GUEST_TRIAL_EXHAUSTED":
      return "游客试用次数已用完，请登录正式账号。";
    default:
      return "当前身份无权执行此操作。";
  }
}
