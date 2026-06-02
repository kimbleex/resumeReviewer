import { createHash, randomBytes, timingSafeEqual, verify as verifySignature } from "node:crypto";

import type { GuestStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export type GuestFingerprintPayload = {
  userAgent?: string;
  language?: string;
  timezone?: string;
  platform?: string;
};

export type GuestTrialDecision =
  | { ok: true }
  | { ok: false; reason: "GUEST_BLOCKED" | "GUEST_TRIAL_EXHAUSTED" };

export function createFingerprintHash(payload: GuestFingerprintPayload): string {
  const normalized = [
    payload.userAgent,
    payload.language,
    payload.timezone,
    payload.platform,
  ]
    .map((value) => (value ?? "").trim().toLowerCase())
    .join("|");

  return createHash("sha256").update(normalized).digest("hex");
}

export function createPublicKeyHash(publicKey: string): string {
  return createHash("sha256").update(publicKey).digest("hex");
}

export function createGuestChallenge(): string {
  return randomBytes(32).toString("base64url");
}

export function canUseGuestTrial(options: {
  status: GuestStatus;
  trialUsedCount: number;
  maxTrialCount: number;
}): GuestTrialDecision {
  if (options.status !== "ACTIVE") {
    return { ok: false, reason: "GUEST_BLOCKED" };
  }

  if (options.trialUsedCount >= options.maxTrialCount) {
    return { ok: false, reason: "GUEST_TRIAL_EXHAUSTED" };
  }

  return { ok: true };
}

export function verifyGuestSignature(options: {
  publicKeyPem: string;
  challenge: string;
  signatureBase64: string;
}): boolean {
  try {
    const signature = Buffer.from(options.signatureBase64, "base64");
    return verifySignature(
      "sha256",
      Buffer.from(options.challenge),
      { key: options.publicKeyPem, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch {
    return false;
  }
}

export function sameHash(first: string, second: string): boolean {
  const left = Buffer.from(first);
  const right = Buffer.from(second);

  return left.length === right.length && timingSafeEqual(left, right);
}

export async function claimGuestIdentity(options: {
  fingerprint: GuestFingerprintPayload;
  publicKeyPem?: string;
}) {
  const fingerprintHash = createFingerprintHash(options.fingerprint);
  const publicKeyHash = options.publicKeyPem ? createPublicKeyHash(options.publicKeyPem) : null;
  const existing = publicKeyHash
    ? await prisma.guestIdentity.findFirst({
        where: {
          OR: [{ publicKeyHash }, { fingerprintHash }],
        },
      })
    : await prisma.guestIdentity.findUnique({ where: { fingerprintHash } });

  if (existing) {
    return prisma.guestIdentity.update({
      where: { id: existing.id },
      data: {
        publicKeyHash: existing.publicKeyHash ?? publicKeyHash,
        lastSeenAt: new Date(),
      },
    });
  }

  return prisma.guestIdentity.create({
    data: {
      fingerprintHash,
      publicKeyHash,
    },
  });
}

export async function reserveGuestTrial(guestId: string) {
  return prisma.$transaction(async (tx) => {
    const guest = await tx.guestIdentity.findUnique({ where: { id: guestId } });

    if (!guest) {
      return { ok: false as const, reason: "GUEST_NOT_FOUND" as const };
    }

    const decision = canUseGuestTrial(guest);
    if (!decision.ok) {
      return decision;
    }

    const updatedGuest = await tx.guestIdentity.update({
      where: { id: guestId },
      data: {
        trialUsedCount: { increment: 1 },
        lastSeenAt: new Date(),
      },
    });

    return { ok: true as const, guest: updatedGuest };
  });
}
