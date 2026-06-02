"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, LogIn, Sparkles, UserRound } from "lucide-react";

import { ReviewStudio, type ReviewIdentity } from "@/components/review-studio";

type UserSummary = {
  id: string;
  username: string;
  role: "ADMIN" | "MEMBER";
  status: "ACTIVE" | "BLOCKED";
};

type GuestSummary = {
  id: string;
  status: "ACTIVE" | "BLOCKED";
  trialUsedCount: number;
  maxTrialCount: number;
  remainingTrialCount: number;
};

const GUEST_KEY_STORAGE = "resume_guest_key_v1";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let value = "";

  for (const byte of bytes) {
    value += String.fromCharCode(byte);
  }

  return btoa(value);
}

function formatPem(base64: string): string {
  const body = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

async function getGuestKeyPair() {
  const stored = localStorage.getItem(GUEST_KEY_STORAGE);
  if (stored) {
    const parsed = JSON.parse(stored) as { privateJwk: JsonWebKey; publicKeyPem: string };
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      parsed.privateJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    return { privateKey, publicKeyPem: parsed.publicKeyPem };
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicSpki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyPem = formatPem(arrayBufferToBase64(publicSpki));
  localStorage.setItem(GUEST_KEY_STORAGE, JSON.stringify({ privateJwk, publicKeyPem }));
  return { privateKey: keyPair.privateKey, publicKeyPem };
}

async function signGuestChallenge(privateKey: CryptoKey, challenge: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(challenge),
  );

  return arrayBufferToBase64(signature);
}

function getFingerprint() {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: navigator.platform,
  };
}

export function AuthGateway() {
  const [identity, setIdentity] = useState<ReviewIdentity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isClaimingGuest, setIsClaimingGuest] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const refreshIdentity = useCallback(async () => {
    setIsLoading(true);
    try {
      const authResponse = await fetch("/api/auth/me");
      const auth = (await authResponse.json()) as { user: UserSummary | null };

      if (auth.user) {
        setIdentity({ kind: "user", user: auth.user });
        return;
      }

      const guestResponse = await fetch("/api/guest/me");
      const guest = (await guestResponse.json()) as { guest: GuestSummary | null };
      setIdentity(guest.guest ? { kind: "guest", guest: guest.guest } : null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshIdentity();
  }, [refreshIdentity]);

  const handleGuestTrial = useCallback(async () => {
    setIsClaimingGuest(true);
    setErrorMessage("");

    try {
      const challengeResponse = await fetch("/api/guest/challenge", { method: "POST" });
      const { challenge } = (await challengeResponse.json()) as { challenge: string };
      const { privateKey, publicKeyPem } = await getGuestKeyPair();
      const signatureBase64 = await signGuestChallenge(privateKey, challenge);
      const claimResponse = await fetch("/api/guest/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge,
          publicKeyPem,
          signatureBase64,
          fingerprint: getFingerprint(),
        }),
      });
      const claim = (await claimResponse.json()) as { guest?: GuestSummary; error?: string };

      if (!claimResponse.ok || !claim.guest) {
        throw new Error(claim.error || "游客身份创建失败。");
      }

      setIdentity({ kind: "guest", guest: claim.guest });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "游客试用启动失败。");
    } finally {
      setIsClaimingGuest(false);
    }
  }, []);

  if (isLoading) {
    return (
      <main className="auth-entry-shell">
        <LoaderCircle className="spin-icon" size={22} />
        <span>正在检查访问身份...</span>
      </main>
    );
  }

  if (identity) {
    return <ReviewStudio identity={identity} onSessionChanged={refreshIdentity} />;
  }

  return (
    <main className="auth-entry-shell">
      <section className="auth-entry-panel">
        <span className="eyebrow">RESUME MULTI-AGENT ACCESS</span>
        <h1>进入智能简历评审工作台</h1>
        <p>
          管理员可以登录后创建正式成员；未登录用户也可以用游客身份试用一次完整诊断。
        </p>
        <div className="auth-entry-actions">
          <a className="primary-action auth-entry-action" href="/login">
            <LogIn size={17} />
            登录正式账号
          </a>
          <button
            className="secondary-action auth-entry-action"
            type="button"
            onClick={handleGuestTrial}
            disabled={isClaimingGuest}
          >
            {isClaimingGuest ? <LoaderCircle className="spin-icon" size={17} /> : <UserRound size={17} />}
            游客试用一次
          </button>
        </div>
        <div className="auth-entry-note">
          <Sparkles size={15} />
          游客身份会绑定浏览器密钥和环境指纹，用于限制重复试用。
        </div>
        {errorMessage ? <div className="top-error-banner">{errorMessage}</div> : null}
      </section>
    </main>
  );
}
