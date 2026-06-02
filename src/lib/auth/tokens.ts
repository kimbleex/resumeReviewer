import { createHash, randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { loadAppEnv } from "@/lib/env";

export type AuthRole = "ADMIN" | "MEMBER";

export type AccessTokenPayload = {
  userId: string;
  sessionId: string;
  role: AuthRole;
};

type CreateAccessTokenOptions = AccessTokenPayload & {
  secret?: string;
  expiresIn?: string;
};

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export function getSessionSecret(): string {
  loadAppEnv();

  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET_KEY;
  if (!secret) {
    throw new Error("SESSION_SECRET or JWT_SECRET_KEY is not configured.");
  }

  return secret;
}

export async function createAccessToken(options: CreateAccessTokenOptions): Promise<string> {
  const secret = options.secret ?? getSessionSecret();

  return new SignJWT({
    userId: options.userId,
    sessionId: options.sessionId,
    role: options.role,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(options.userId)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "2h")
    .sign(encodeSecret(secret));
}

export async function verifyAccessToken(token: string, secret = getSessionSecret()): Promise<AccessTokenPayload> {
  const result = await jwtVerify(token, encodeSecret(secret));
  const payload = result.payload;

  if (
    typeof payload.userId !== "string" ||
    typeof payload.sessionId !== "string" ||
    (payload.role !== "ADMIN" && payload.role !== "MEMBER")
  ) {
    throw new Error("Invalid access token payload.");
  }

  return {
    userId: payload.userId,
    sessionId: payload.sessionId,
    role: payload.role,
  };
}

export function createRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
