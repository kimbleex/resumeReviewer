import { cookies } from "next/headers";

import type { ReviewIdentity } from "@/components/review-studio";
import { prisma } from "@/lib/db/prisma";

import { ensureInitialAdmin } from "./bootstrap";
import { ACCESS_TOKEN_COOKIE, GUEST_ID_COOKIE } from "./cookies";
import { canUseUserSession } from "./sessions";
import { verifyAccessToken } from "./tokens";

/**
 * Resolve the request identity on the server during a Server Component render,
 * reading cookies via `next/headers`. Mirrors the logic of
 * `resolveUserSession` / `resolveGuest` (actors.ts) and the /api/guest/me route,
 * differing only in the cookie source.
 *
 * Important: a Server Component cannot mutate cookies during render, so this
 * helper does NOT perform the silent token refresh. When the access token is
 * expired/invalid it returns `null`, and the client falls back to the existing
 * refresh chain in AuthGateway. The common case (valid access token or guest
 * cookie) is resolved here, eliminating the initial client request waterfall.
 *
 * Any failure resolves to `null` — this must never throw and block first paint.
 */
export async function resolveServerIdentity(): Promise<ReviewIdentity | null> {
  try {
    await ensureInitialAdmin();

    const cookieStore = await cookies();

    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
    if (accessToken) {
      try {
        const payload = await verifyAccessToken(accessToken);
        const session = await prisma.session.findUnique({
          where: { id: payload.sessionId },
          include: { user: true },
        });

        if (session && session.userId === payload.userId) {
          const decision = canUseUserSession({
            userStatus: session.user.status,
            sessionStatus: session.status,
            expiresAt: session.expiresAt,
          });

          if (decision.ok) {
            return {
              kind: "user",
              user: {
                id: session.user.id,
                username: session.user.username,
                role: session.user.role,
                status: session.user.status,
              },
            };
          }
        }
      } catch {
        // Expired / invalid access token — fall through to guest resolution,
        // and ultimately to the client-side refresh fallback.
      }
    }

    const guestId = cookieStore.get(GUEST_ID_COOKIE)?.value;
    if (guestId) {
      const guest = await prisma.guestIdentity.findUnique({ where: { id: guestId } });
      if (guest) {
        // Surface the guest even when the trial is exhausted, so the workspace
        // can render with "剩余 0 次" instead of bouncing back to login.
        const remainingTrialCount = Math.max(0, guest.maxTrialCount - guest.trialUsedCount);
        return {
          kind: "guest",
          guest: {
            id: guest.id,
            status: guest.status,
            trialUsedCount: guest.trialUsedCount,
            maxTrialCount: guest.maxTrialCount,
            remainingTrialCount,
          },
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}
