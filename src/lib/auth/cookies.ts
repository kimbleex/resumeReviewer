import type { NextResponse } from "next/server";

export const ACCESS_TOKEN_COOKIE = "resume_access";
export const REFRESH_TOKEN_COOKIE = "resume_refresh";
export const GUEST_ID_COOKIE = "resume_guest";
export const GUEST_CHALLENGE_COOKIE = "resume_guest_challenge";

const isProduction = process.env.NODE_ENV === "production";

export function setAuthCookies(response: NextResponse, tokens: { accessToken: string; refreshToken: string }) {
  response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: 15 * 60,
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: 14 * 24 * 60 * 60,
  });
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.delete(ACCESS_TOKEN_COOKIE);
  response.cookies.delete(REFRESH_TOKEN_COOKIE);
}

export function clearGuestCookie(response: NextResponse) {
  response.cookies.delete(GUEST_ID_COOKIE);
}

export function setGuestCookie(response: NextResponse, guestId: string) {
  response.cookies.set(GUEST_ID_COOKIE, guestId, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: 90 * 24 * 60 * 60,
  });
}

export function setGuestChallengeCookie(response: NextResponse, challenge: string) {
  response.cookies.set(GUEST_CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: 10 * 60,
  });
}

export function clearGuestChallengeCookie(response: NextResponse) {
  response.cookies.delete(GUEST_CHALLENGE_COOKIE);
}
